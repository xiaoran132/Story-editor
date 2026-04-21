import React from 'react';
import { GripHorizontal, Settings2, GitBranch, MessageSquare } from 'lucide-react';

interface EditorNodeProps {
  id?: string;
  type?: 'narrative' | 'choice' | 'ai-prompt';
  title?: string;
  x?: number;
  y?: number;
  selected?: boolean;
}

const EditorNode: React.FC<EditorNodeProps> = ({
  id = "N-01",
  type = 'narrative',
  title = "初遇神秘人",
  x = 100,
  y = 100,
  selected = false
}) => {
  
  const getTypeConfig = () => {
    switch(type) {
      case 'choice': return { icon: GitBranch, color: 'rgba(56,189,248,1)', bg: 'rgba(56,189,248,0.1)' };
      case 'ai-prompt': return { icon: MessageSquare, color: 'rgba(168,85,247,1)', bg: 'rgba(168,85,247,0.1)' };
      default: return { icon: Settings2, color: 'rgba(34,197,94,1)', bg: 'rgba(34,197,94,0.1)' }; // Green for narrative
    }
  };

  const config = getTypeConfig();
  const Icon = config.icon;

  return (
    <div 
      data-cmp="EditorNode"
      className={`absolute w-64 glass-panel transition-all duration-200 cursor-move ${
        selected ? 'border-[rgba(168,85,247,0.6)] shadow-custom z-10' : 'border-white/10 hover:border-white/30 z-0'
      }`}
      style={{ left: x, top: y }}
    >
      <div className="flex items-center justify-between p-3 border-b border-white/5 bg-white/5">
        <div className="flex items-center gap-2">
          <GripHorizontal className="w-4 h-4 text-muted-foreground" />
          <div 
            className="w-6 h-6 rounded flex items-center justify-center"
            style={{ backgroundColor: config.bg, color: config.color }}
          >
            <Icon className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-mono text-muted-foreground">{id}</span>
        </div>
        <button className="text-muted-foreground hover:text-white transition-colors">
          <Settings2 className="w-4 h-4" />
        </button>
      </div>
      
      <div className="p-4">
        <h4 className="text-sm font-medium text-white mb-2">{title}</h4>
        {type === 'narrative' && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            你推开了那扇生锈的金属门，刺眼的霓虹光从缝隙中透入...
          </p>
        )}
        {type === 'choice' && (
          <div className="space-y-1.5 mt-2">
            <div className="text-xs px-2 py-1 rounded bg-white/5 border border-white/5 text-gray-300">分支 1: 拔枪警告</div>
            <div className="text-xs px-2 py-1 rounded bg-white/5 border border-white/5 text-gray-300">分支 2: 保持沉默</div>
          </div>
        )}
        {type === 'ai-prompt' && (
          <div className="mt-2 text-xs px-2 py-1.5 rounded bg-[rgba(168,85,247,0.1)] border border-[rgba(168,85,247,0.2)] text-[rgba(216,180,254,1)]">
            System: 根据玩家心情动态生成对话。
          </div>
        )}
      </div>

      {/* Connection Points */}
      <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 bg-[rgba(10,5,24,1)] border-2 border-white/30 rounded-full hover:border-[rgba(56,189,248,1)] transition-colors cursor-crosshair"></div>
      <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 bg-[rgba(10,5,24,1)] border-2 border-white/30 rounded-full hover:border-[rgba(168,85,247,1)] transition-colors cursor-crosshair"></div>
    </div>
  );
};

export default EditorNode;