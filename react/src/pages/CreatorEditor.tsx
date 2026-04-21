import React from 'react';
import { Plus, Maximize, Play, Settings, Save, ListTree, Lightbulb, MessageSquare } from 'lucide-react';
import EditorNode from '../components/EditorNode';

const CreatorEditor: React.FC = () => {
  console.log("Rendering Visual Creator Editor");

  return (
    <div className="h-[calc(100vh-80px)] flex flex-col max-w-[1440px] mx-auto">
      
      {/* Editor Toolbar */}
      <div className="h-14 border-b border-white/10 flex items-center justify-between px-6 bg-[rgba(255,255,255,0.02)] backdrop-blur-md">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-bold text-white">故事图谱 - "霓虹阴影"</h2>
          <div className="px-2 py-1 rounded bg-[rgba(34,197,94,0.1)] border border-[rgba(34,197,94,0.2)] text-[rgba(34,197,94,1)] text-xs font-mono">
            已自动保存
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-medium transition-colors">
            <Play className="w-4 h-4 text-[rgba(56,189,248,1)]" /> 测试运行
          </button>
          <button className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-gradient-to-r from-[rgba(168,85,247,1)] to-[rgba(126,34,206,1)] border border-transparent text-white text-sm font-medium hover:shadow-custom transition-all">
            <Save className="w-4 h-4" /> 发布更新
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        
        {/* Left Sidebar - AI Tools */}
        <aside className="w-72 border-r border-white/10 bg-[rgba(10,5,24,0.6)] flex flex-col p-4">
          <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-[rgba(168,85,247,1)]" /> AI 创作助手
          </h3>
          
          <div className="space-y-4 flex-1 overflow-y-auto pr-2 custom-scrollbar">
            <div className="glass-panel p-4 border border-[rgba(168,85,247,0.3)] bg-[rgba(168,85,247,0.05)]">
              <h4 className="text-xs font-bold text-[rgba(216,180,254,1)] mb-2">生成分支选项</h4>
              <p className="text-xs text-gray-300 mb-3">为 "初遇神秘人" 节点生成 3 个不同性格维度的玩家选项。</p>
              <button className="w-full py-1.5 rounded bg-[rgba(168,85,247,0.2)] hover:bg-[rgba(168,85,247,0.3)] text-[rgba(216,180,254,1)] text-xs font-medium transition-colors">
                一键生成
              </button>
            </div>

            <div className="glass-panel p-4">
              <h4 className="text-xs font-bold text-gray-300 mb-2">全局人设设定 (Agent)</h4>
              <div className="flex gap-2 mb-2">
                <span className="px-2 py-1 bg-white/5 rounded text-xs text-gray-400">赛博朋克</span>
                <span className="px-2 py-1 bg-white/5 rounded text-xs text-gray-400">黑色幽默</span>
              </div>
              <button className="w-full py-1.5 rounded border border-white/10 hover:bg-white/5 text-gray-300 text-xs font-medium transition-colors">
                调整模型参数
              </button>
            </div>
            
            <div className="glass-panel p-4">
              <h4 className="text-xs font-bold text-gray-300 mb-2">添加节点</h4>
              <div className="grid grid-cols-2 gap-2">
                <button className="flex flex-col items-center justify-center p-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 gap-1 transition-colors">
                  <ListTree className="w-5 h-5 text-[rgba(34,197,94,1)]" />
                  <span className="text-[10px] text-gray-300">剧情节点</span>
                </button>
                <button className="flex flex-col items-center justify-center p-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 gap-1 transition-colors">
                  <MessageSquare className="w-5 h-5 text-[rgba(56,189,248,1)]" />
                  <span className="text-[10px] text-gray-300">分支选项</span>
                </button>
              </div>
            </div>
          </div>
        </aside>

        {/* Center Canvas */}
        <div className="flex-1 relative bg-[#0B0616] overflow-hidden" 
             style={{ 
               backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.1) 1px, transparent 1px)',
               backgroundSize: '24px 24px'
             }}>
          
          {/* SVG Connection Lines */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
            <path d="M 356 164 C 450 164, 450 264, 550 264" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2" strokeDasharray="5,5" />
            <path d="M 356 164 C 450 164, 450 84, 550 84" fill="none" stroke="rgba(56,189,248,0.5)" strokeWidth="2" />
          </svg>

          {/* Nodes */}
          <EditorNode id="N-01" type="narrative" title="开场：深网酒吧" x={100} y={100} />
          <EditorNode id="N-02" type="choice" title="玩家决策：面对敌人" x={550} y={40} selected={true} />
          <EditorNode id="N-03" type="ai-prompt" title="AI动态判定：隐匿" x={550} y={200} />

          {/* Canvas Controls */}
          <div className="absolute bottom-6 right-6 flex gap-2">
            <button className="w-10 h-10 glass-panel flex items-center justify-center text-white hover:bg-white/10">
              <Plus className="w-5 h-5" />
            </button>
            <button className="w-10 h-10 glass-panel flex items-center justify-center text-white hover:bg-white/10">
              <Maximize className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Right Sidebar - Properties */}
        <aside className="w-80 border-l border-white/10 bg-[rgba(10,5,24,0.6)] p-5 overflow-y-auto">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-bold text-white">节点属性</h3>
            <Settings className="w-4 h-4 text-gray-400" />
          </div>
          
          <div className="space-y-5">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">节点名称</label>
              <input 
                type="text" 
                value="玩家决策：面对敌人" 
                className="w-full bg-[rgba(255,255,255,0.05)] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[rgba(168,85,247,0.5)]"
                readOnly
              />
            </div>
            
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">UI 显示文本</label>
              <textarea 
                rows={4}
                className="w-full bg-[rgba(255,255,255,0.05)] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[rgba(168,85,247,0.5)] custom-scrollbar"
                defaultValue="分支 1: 拔枪警告\n分支 2: 保持沉默\n(允许玩家自由输入)"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">AI 代理角色卡 (System Prompt)</label>
              <textarea 
                rows={6}
                className="w-full bg-[rgba(168,85,247,0.05)] border border-[rgba(168,85,247,0.3)] rounded-lg px-3 py-2 text-xs font-mono text-[rgba(216,180,254,1)] focus:outline-none focus:border-[rgba(168,85,247,0.6)] custom-scrollbar"
                defaultValue="你是一个冷酷、专业的赛博朋克情报商。根据玩家的选择，动态生成你的回应，并扣除玩家相应的【神经负荷】。回应必须简短、充满金属质感。"
              />
            </div>
          </div>
        </aside>

      </div>
    </div>
  );
};

export default CreatorEditor;