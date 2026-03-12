import { HTMLAttributes } from 'react';

interface SectionLabelProps extends HTMLAttributes<HTMLHeadingElement> {
  as?: 'h2' | 'h3' | 'h4' | 'p' | 'span';
}

export function SectionLabel({ as: Tag = 'h3', className = '', children, ...props }: SectionLabelProps) {
  return (
    <Tag
      className={`text-xs font-semibold uppercase tracking-wider text-zinc-500 ${className}`.trim()}
      {...props}
    >
      {children}
    </Tag>
  );
}
