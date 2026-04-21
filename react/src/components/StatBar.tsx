import React from 'react';

interface StatBarProps {
  label?: string;
  value?: number;
  max?: number;
  icon?: React.ReactNode;
  color?: string;
}

const StatBar: React.FC<StatBarProps> = ({
  label = "生命值",
  value = 85,
  max = 100,
  icon,
  color = "rgba(239,68,68,1)" // default red
}) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  
  return (
    <div data-cmp="StatBar" className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
          {icon && <span style={{ color }}>{icon}</span>}
          {label}
        </div>
        <div className="text-xs font-mono text-muted-foreground">
          <span className="text-white">{value}</span> / {max}
        </div>
      </div>
      <div className="h-2 w-full bg-[rgba(255,255,255,0.1)] rounded-full overflow-hidden border border-white/5">
        <div 
          className="h-full rounded-full transition-all duration-1000 relative"
          style={{ 
            width: `${percentage}%`,
            backgroundColor: color,
            boxShadow: `0 0 10px ${color}`
          }}
        >
          {/* Highlight effect on the bar */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent to-white/30"></div>
        </div>
      </div>
    </div>
  );
};

export default StatBar;