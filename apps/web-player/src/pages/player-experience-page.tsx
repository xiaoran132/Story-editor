import React, { useState } from 'react';
import { Send, Cpu, Heart, Brain, Zap, Shield, Image as ImageIcon, Volume2, Save } from 'lucide-react';
import StatBar from '../components/StatBar';

const PlayerExperience: React.FC = () => {
  const [inputText, setInputText] = useState("");
  
  console.log("Rendering Player Experience UI");

  return (
    <div className="h-[calc(100vh-80px)] flex max-w-[1440px] mx-auto overflow-hidden">
      
      {/* Sidebar - Character & Stats */}
      <aside className="w-80 h-full border-r border-white/10 glass-panel rounded-none bg-[rgba(10,5,24,0.7)] flex flex-col">
        <div className="p-6 border-b border-white/5">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-white tracking-wider">STATUS</h2>
            <button className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 transition-colors" title="保存进度">
              <Save className="w-4 h-4" />
            </button>
          </div>
          
          {/* Character Avatar */}
          <div className="relative w-full aspect-square rounded-2xl overflow-hidden mb-6 border border-white/10 group">
            <img 
              src="https://images.unsplash.com/photo-1535295972055-1c762f4483e5?q=80&w=800&auto=format&fit=crop" 
              alt="Character" 
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[rgba(10,5,24,0.9)] to-transparent" />
            <div className="absolute bottom-4 left-4">
              <h3 className="text-lg font-bold text-white">Kaelen_99</h3>
              <p className="text-xs text-[rgba(56,189,248,1)]">边缘区骇客 [Lv. 14]</p>
            </div>
            
            {/* Cyberpunk scanning line effect */}
            <div className="absolute inset-0 w-full h-[2px] bg-[rgba(56,189,248,0.5)] shadow-[0_0_10px_rgba(56,189,248,1)] animate-pulse hidden group-hover:block" style={{ animationDuration: '2s', top: '50%' }}></div>
          </div>

          {/* Stats */}
          <div className="space-y-2">
            <StatBar label="生命值 (HP)" value={78} max={100} icon={<Heart className="w-4 h-4" />} color="rgba(239,68,68,1)" />
            <StatBar label="神经负荷 (Neural)" value={45} max={100} icon={<Brain className="w-4 h-4" />} color="rgba(168,85,247,1)" />
            <StatBar label="能量核心 (Energy)" value={90} max={100} icon={<Zap className="w-4 h-4" />} color="rgba(234,179,8,1)" />
            <StatBar label="隐匿度 (Stealth)" value={30} max={100} icon={<Shield className="w-4 h-4" />} color="rgba(56,189,248,1)" />
          </div>
        </div>
        
        {/* Inventory/Items */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          <h3 className="text-xs font-bold text-gray-500 uppercase mb-4">物品栏 (Inventory)</h3>
          <div className="grid grid-cols-4 gap-2">
            {[...Array(12)].map((_, i) => (
              <div key={i} className="aspect-square rounded-lg bg-white/5 border border-white/5 flex items-center justify-center hover:border-white/20 hover:bg-white/10 cursor-pointer transition-colors">
                {i === 0 && <Cpu className="w-5 h-5 text-[rgba(56,189,248,1)]" />}
                {i === 3 && <div className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />}
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Main Gameplay Area */}
      <main className="flex-1 flex flex-col h-full relative">
        
        {/* Scene Background overlay */}
        <div className="absolute inset-0 z-0 pointer-events-none opacity-20">
          <img src="https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?q=80&w=2000&auto=format&fit=crop" className="w-full h-full object-cover" alt="Scene" />
          <div className="absolute inset-0 bg-gradient-to-t from-[rgba(10,5,24,1)] via-[rgba(10,5,24,0.8)] to-[rgba(10,5,24,0.4)]" />
        </div>

        {/* Top bar controls */}
        <div className="relative z-10 h-14 border-b border-white/10 flex items-center justify-between px-6 bg-[rgba(10,5,24,0.5)] backdrop-blur-md">
          <div className="flex items-center gap-3">
            <span className="flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-[rgba(168,85,247,1)] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[rgba(168,85,247,1)]"></span>
            </span>
            <span className="text-xs font-mono text-[rgba(216,180,254,1)]">AI 叙事引擎在线</span>
          </div>
          <div className="flex gap-3">
            <button className="p-2 rounded hover:bg-white/10 text-gray-400 transition-colors"><ImageIcon className="w-4 h-4" /></button>
            <button className="p-2 rounded hover:bg-white/10 text-gray-400 transition-colors"><Volume2 className="w-4 h-4" /></button>
          </div>
        </div>

        {/* Narrative Flow */}
        <div className="flex-1 relative z-10 p-8 overflow-y-auto custom-scrollbar flex flex-col gap-6">
          <div className="max-w-3xl mx-auto w-full space-y-8 pb-10">
            
            {/* Story Text */}
            <div className="prose prose-invert max-w-none">
              <p className="text-lg leading-relaxed text-gray-200">
                雨水打在霓虹灯管上发出滋滋的声响。你站在「深网酒吧」的后巷，空气中弥漫着臭氧和廉价合成酒精的味道。
              </p>
              <p className="text-lg leading-relaxed text-gray-200">
                前方的金属门紧闭，但你的神经植入物正在警告你：<span className="text-[rgba(239,68,68,1)] font-bold">有三具战斗义体正在快速接近。</span>
              </p>
            </div>

            {/* AI Generated Character Dialog */}
            <div className="flex gap-4 items-start">
              <div className="w-10 h-10 rounded-full bg-white/10 border border-white/20 flex-shrink-0 overflow-hidden">
                <img src="https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=200&auto=format&fit=crop" alt="NPC" className="w-full h-full object-cover" />
              </div>
              <div className="glass-panel p-4 flex-1 border-[rgba(56,189,248,0.3)] shadow-[0_0_15px_rgba(56,189,248,0.1)] rounded-tl-none">
                <p className="text-xs font-bold text-[rgba(56,189,248,1)] mb-1">Elara (情报商)</p>
                <p className="text-gray-200">"Kaelen，你被发现了。公司的人在一分钟内就会封锁这个街区。你的骇客模块修好了吗？"</p>
              </div>
            </div>

            {/* Quick Choices */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-8">
              <button className="glass-panel p-4 text-left border-[rgba(168,85,247,0.3)] hover:bg-[rgba(168,85,247,0.1)] hover:border-[rgba(168,85,247,0.6)] transition-all group">
                <div className="flex items-center gap-2 mb-1">
                  <Cpu className="w-4 h-4 text-[rgba(168,85,247,1)]" />
                  <span className="text-xs font-mono text-[rgba(216,180,254,1)]">[骇入] 门禁系统</span>
                </div>
                <p className="text-sm text-gray-300 group-hover:text-white">尝试强行破解金属门的密码锁，可能触发二级警报。</p>
              </button>
              
              <button className="glass-panel p-4 text-left border-white/10 hover:bg-white/10 hover:border-white/30 transition-all group">
                <div className="flex items-center gap-2 mb-1">
                  <Shield className="w-4 h-4 text-gray-400 group-hover:text-white" />
                  <span className="text-xs font-mono text-gray-300 group-hover:text-white">[隐蔽] 躲进垃圾箱</span>
                </div>
                <p className="text-sm text-gray-400 group-hover:text-gray-200">屏住呼吸等待他们过去，但这极度考验你的隐匿度。</p>
              </button>
            </div>

          </div>
        </div>

        {/* AI Input Area */}
        <div className="relative z-10 p-6 bg-gradient-to-t from-[rgba(10,5,24,1)] to-transparent">
          <div className="max-w-3xl mx-auto relative group">
            {/* Glow effect under input */}
            <div className="absolute -inset-1 bg-gradient-to-r from-[rgba(168,85,247,0.5)] to-[rgba(56,189,248,0.5)] rounded-2xl blur opacity-30 group-hover:opacity-60 transition duration-1000 group-hover:duration-200"></div>
            
            <div className="relative glass-panel bg-[rgba(20,10,35,0.8)] border border-white/20 rounded-2xl flex items-center p-2 focus-within:border-[rgba(168,85,247,0.6)] focus-within:shadow-custom transition-all">
              <input 
                type="text" 
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="输入自由行动指令，AI 将动态生成剧情回应..." 
                className="w-full bg-transparent border-none text-white px-4 py-2 focus:outline-none placeholder:text-gray-500"
              />
              <button className="w-10 h-10 rounded-xl bg-gradient-to-br from-[rgba(168,85,247,1)] to-[rgba(56,189,248,1)] flex items-center justify-center hover:opacity-90 transition-opacity flex-shrink-0 ml-2">
                <Send className="w-5 h-5 text-white" />
              </button>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
};

export default PlayerExperience;