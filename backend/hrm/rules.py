"""
Rules module for HRM that provides the same interface as rule.rules
but uses database models from hrm.event_models.py
"""

# Note: We don't import Django models at the top level to avoid import errors
# when Django is not configured. Instead, we import them inside methods.


class RuleRegistry:
    """
    Wrapper class that provides the same interface as rule.rules.RuleRegistry
    but uses the database backend.
    """
    def __init__(self):
        pass  # No initialization needed
    
    def get_rules_for_employee(self, employee_code: str, employee_info: dict = None) -> list:
        """
        Get all rules that apply to a specific employee.
        
        Args:
            employee_code: The employee code
            employee_info: Optional dictionary with employee information
        
        Returns:
            List of rules that apply to the employee, sorted by priority
        """
        # Import inside method to avoid Django import errors
        from .event_models import RuleRegistry as DBRuleRegistry
        
        db_registry = DBRuleRegistry()
        return db_registry.get_rules_for_employee(employee_code, employee_info)
    
    def get_rules_by_scope(self, scope: str, identifier: str = None) -> list:
        """
        Get all rules for a specific scope.
        
        Args:
            scope: One of RuleScope values
            identifier: Optional identifier for the scope
        
        Returns:
            List of rules for the specified scope
        """
        # Import inside method to avoid Django import errors
        from .event_models import RuleDefinition, RuleScope
        from django.utils import timezone
        
        today = timezone.now().date()
        query = RuleDefinition.objects.filter(
            is_active=True,
            effective_from__lte=today
        ).exclude(
            effective_to__lt=today
        )
        
        if scope == RuleScope.COMPANY:
            query = query.filter(scope=scope, identifier="ALL")
        else:
            query = query.filter(scope=scope, identifier=identifier)
        
        return [rule.to_dict() for rule in query]


def initialize_rule_registry():
    """
    Initialize the rule registry.
    For database backend, this is a no-op since rules are loaded from database on demand.
    """
    print("Rule registry initialized (database backend)")


def get_rules_for_employee(employee_code: str, employee_info: dict = None):
    """
    Get rules for a specific employee, considering all applicable scopes.
    
    Args:
        employee_code: The employee code
        employee_info: Optional dictionary with employee information
    
    Returns:
        List of rules that apply to the employee, sorted by priority
    """
    registry = RuleRegistry()
    return registry.get_rules_for_employee(employee_code, employee_info)


def get_rules_by_scope(scope: str, identifier: str = None):
    """
    Get all rules for a specific scope.
    
    Args:
        scope: One of RuleScope values
        identifier: Optional identifier for the scope
    
    Returns:
        List of rules for the specified scope
    """
    registry = RuleRegistry()
    return registry.get_rules_by_scope(scope, identifier)


def add_rule_for_scope(rule_name: str, rule_type: str, conditions: dict, 
                       scope: str, identifier: str, priority: int = 0):
    """
    Add a new rule for a specific scope to the database.
    
    Args:
        rule_name: Name of the rule
        rule_type: Type of the rule (SHIFT_RULE_MORNING, etc.)
        conditions: Rule conditions dictionary
        scope: One of RuleScope values
        identifier: Employee code, group ID, department ID, or "ALL" for company
        priority: Rule priority (higher overrides lower)
    """
    # Import inside method to avoid Django import errors
    from .event_models import RuleDefinition
    from django.utils import timezone
    
    # Create rule in database
    rule = RuleDefinition.objects.create(
        rule_name=rule_name,
        rule_type=rule_type,
        conditions=conditions,
        scope=scope,
        identifier=identifier,
        priority=priority,
        is_active=True,
        effective_from=timezone.now().date()
    )
    print(f"Added rule '{rule_name}' to database for {scope}:{identifier} with priority {priority}")


# Create a global instance for backward compatibility
_rule_registry = RuleRegistry()
