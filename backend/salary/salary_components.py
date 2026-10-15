"""
salary_components.py
Tính từng loại thành phần lương (ComponentCalculator).
"""
import ast
import operator
from decimal import Decimal
from typing import Any


# ---------------------------------------------------------------------------
# Safe expression evaluator
# ---------------------------------------------------------------------------

_SAFE_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}

_SAFE_FUNCS = {
    'min': min,
    'max': max,
    'abs': abs,
    'round': round,
}


def _safe_eval(expression: str, ctx: dict) -> Decimal:
    """
    Đánh giá biểu thức số học an toàn với các biến từ ctx.
    Chỉ cho phép phép tính (+, -, *, /, //, %, **), hàm min/max/abs/round,
    và biến được khai báo trong ctx. Không cho phép gọi hàm tùy ý hay import.
    """
    tree = ast.parse(expression.strip(), mode='eval')

    def _eval_node(node: Any) -> Any:
        match node:
            case ast.Expression(body=body):
                return _eval_node(body)
            case ast.Constant(value=v):
                return v
            case ast.Name(id=name):
                if name in ctx:
                    return ctx[name]
                raise ValueError(f"Biến không xác định trong biểu thức: '{name}'")
            case ast.BinOp(left=left, op=op, right=right):
                op_fn = _SAFE_OPS.get(type(op))
                if op_fn is None:
                    raise ValueError(f"Phép tính không được hỗ trợ: {type(op).__name__}")
                return op_fn(_eval_node(left), _eval_node(right))
            case ast.UnaryOp(op=op, operand=operand):
                op_fn = _SAFE_OPS.get(type(op))
                if op_fn is None:
                    raise ValueError(f"Phép tính không được hỗ trợ: {type(op).__name__}")
                return op_fn(_eval_node(operand))
            case ast.Call(func=ast.Name(id=func_name), args=args, keywords=keywords):
                if func_name not in _SAFE_FUNCS:
                    raise ValueError(f"Hàm không được phép trong biểu thức: '{func_name}'")
                if keywords:
                    raise ValueError("Keyword arguments không được hỗ trợ trong expression")
                return _SAFE_FUNCS[func_name](*[_eval_node(a) for a in args])
            case ast.IfExp(test=test, body=body, orelse=orelse):
                return _eval_node(body) if _eval_node(test) else _eval_node(orelse)
            case ast.Compare(left=left, ops=ops, comparators=comparators):
                lv = _eval_node(left)
                result = True
                for cmp_op, cmp_node in zip(ops, comparators):
                    rv = _eval_node(cmp_node)
                    match cmp_op:
                        case ast.Eq():
                            result = result and lv == rv
                        case ast.NotEq():
                            result = result and lv != rv
                        case ast.Lt():
                            result = result and lv < rv
                        case ast.LtE():
                            result = result and lv <= rv
                        case ast.Gt():
                            result = result and lv > rv
                        case ast.GtE():
                            result = result and lv >= rv
                        case _:
                            raise ValueError(f"So sánh không được hỗ trợ: {type(cmp_op).__name__}")
                    lv = rv
                return result
            case _:
                raise ValueError(f"Node AST không được hỗ trợ: {type(node).__name__}")

    result = _eval_node(tree)
    return Decimal(str(result))


# ---------------------------------------------------------------------------
# Progressive tax helper
# ---------------------------------------------------------------------------

def _compute_progressive_tax(taxable_income: Decimal, bracket_config) -> Decimal:
    """
    Tính thuế TNCN lũy tiến theo TaxBracketConfig.
    taxable_income: thu nhập chịu thuế (sau giảm trừ gia cảnh / bảo hiểm).
    """
    if taxable_income <= Decimal('0'):
        return Decimal('0')

    total_tax = Decimal('0')
    brackets = bracket_config.brackets.order_by('order')

    for bracket in brackets:
        lower = bracket.min_income
        upper = bracket.max_income  # None = không giới hạn

        if taxable_income <= lower:
            break

        taxable_in_bracket = (
            taxable_income - lower
            if upper is None
            else min(taxable_income, upper) - lower
        )

        if taxable_in_bracket <= 0:
            continue

        total_tax += taxable_in_bracket * bracket.rate

    return total_tax


def _compute_progressive_tax_with_breakdown(taxable_income: Decimal, bracket_config) -> tuple[Decimal, list[dict]]:
    """
    Tính thuế lũy tiến và trả thêm breakdown theo từng bậc.
    """
    if taxable_income <= Decimal('0'):
        return Decimal('0'), []

    total_tax = Decimal('0')
    details: list[dict] = []
    brackets = bracket_config.brackets.order_by('order')

    for bracket in brackets:
        lower = bracket.min_income
        upper = bracket.max_income  # None = không giới hạn

        if taxable_income <= lower:
            break

        taxable_in_bracket = (
            taxable_income - lower
            if upper is None
            else min(taxable_income, upper) - lower
        )

        if taxable_in_bracket <= 0:
            continue

        tax_amount = taxable_in_bracket * bracket.rate
        total_tax += tax_amount
        details.append({
            'order': bracket.order,
            'min_income': float(lower),
            'max_income': float(upper) if upper is not None else None,
            'rate': float(bracket.rate),
            'taxable_amount': float(taxable_in_bracket),
            'tax_amount': float(tax_amount),
        })

    return total_tax, details


# ---------------------------------------------------------------------------
# ComponentCalculator
# ---------------------------------------------------------------------------

class ComponentCalculator:
    """Tính giá trị của một SalaryComponent dựa theo calc_method và ctx."""

    @staticmethod
    def calculate(comp, ctx: dict) -> Decimal:
        """
        comp: SalaryComponent instance
        ctx: dict chứa các biến tính toán.
             Biến cơ bản: basic_salary, allowance, work_days, ot_hours,
               ot_weekday_hours, ot_weekend_hours, ot_holiday_hours,
               work_coefficient, late_minutes, gross_salary,
               kpi_score, revenue, kpi_bonus_amount, commission_amount,
               taxable_income (optional, dùng cho PROGRESSIVE_TAX),
               và mã của các component đã tính trước.
        Trả về Decimal (có thể âm với khoản DEDUCTION).
        """
        match comp.calc_method:
            case 'FIXED':
                return comp.fixed_amount or Decimal('0')

            case 'PCT_BASIC':
                basic = Decimal(str(ctx.get('basic_salary', 0)))
                pct = comp.percentage or Decimal('0')
                return basic * pct

            case 'PCT_GROSS':
                gross = Decimal(str(ctx.get('gross_salary', 0)))
                pct = comp.percentage or Decimal('0')
                return gross * pct

            case 'PER_WORK_DAY':
                rate = comp.fixed_amount or Decimal('0')
                days = Decimal(str(ctx.get('work_days', 0)))
                return rate * days

            case 'PER_OT_HOUR':
                rate = comp.fixed_amount or Decimal('0')
                hours = Decimal(str(ctx.get('ot_hours', 0)))
                return rate * hours

            case 'PER_OT_WEEKDAY':
                rate = comp.fixed_amount or Decimal('0')
                hours = Decimal(str(ctx.get('ot_weekday_hours', 0)))
                return rate * hours

            case 'PER_OT_WEEKEND':
                rate = comp.fixed_amount or Decimal('0')
                hours = Decimal(str(ctx.get('ot_weekend_hours', 0)))
                return rate * hours

            case 'PER_OT_HOLIDAY':
                rate = comp.fixed_amount or Decimal('0')
                hours = Decimal(str(ctx.get('ot_holiday_hours', 0)))
                return rate * hours

            case 'PROGRESSIVE_TAX':
                # Import ở đây để tránh import vòng ở module level
                from .salary_data_models import TaxBracketConfig
                taxable_source = ctx.get('taxable_income', ctx.get('auto_taxable_income', ctx.get('gross_salary', 0)))
                taxable = Decimal(str(taxable_source))
                bracket_config = ctx.get('tax_bracket_config') or TaxBracketConfig.get_active()
                if not bracket_config:
                    return Decimal('0')

                total_tax, breakdown = _compute_progressive_tax_with_breakdown(taxable, bracket_config)
                ctx['_progressive_tax_meta'] = {
                    'config_id': bracket_config.id,
                    'config_name': bracket_config.name,
                    'personal_deduction': float(Decimal(str(ctx.get('personal_deduction', 0)))),
                    'dependent_count': int(ctx.get('tax_dependents', 0) or 0),
                    'dependent_deduction_per_person': float(Decimal(str(ctx.get('dependent_deduction_per_person', 0)))),
                    'dependent_deduction_total': float(Decimal(str(ctx.get('dependent_deduction_total', 0)))),
                    'taxable_income': float(taxable),
                    'gross_salary_for_tax': float(Decimal(str(ctx.get('gross_salary', 0)))),
                    'deduction_before_tax': float(Decimal(str(ctx.get('deduction_before_tax', 0)))),
                    'brackets': breakdown,
                    'total_tax': float(total_tax),
                }
                return total_tax

            case 'FORMULA':
                if not comp.expression:
                    return Decimal('0')
                return _safe_eval(comp.expression, ctx)

            case _:
                return Decimal('0')
