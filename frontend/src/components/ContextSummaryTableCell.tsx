import ResponsiveContextSummary from './ResponsiveContextSummary';

interface ContextSummaryTableCellProps {
  contextSummary?: string;
  className?: string;
  maxWidth?: string;
  showIcon?: boolean;
}

export default function ContextSummaryTableCell({
  contextSummary,
  className = '',
  maxWidth = 'w-64',
  showIcon = true,
}: ContextSummaryTableCellProps) {
  return (
    <td className={`table-cell ${maxWidth} ${className}`}>
      <ResponsiveContextSummary
        contextSummary={contextSummary}
        showIcon={showIcon}
        breakpoint="md"
        className="w-full"
      />
    </td>
  );
}
