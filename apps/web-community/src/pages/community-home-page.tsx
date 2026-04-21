import React from 'react';
import { Zap, TrendingUp, Sparkles, Filter } from 'lucide-react';
import StoryCard from '../components/StoryCard';

const Community: React.FC = () => {
  console.log("Rendering Community Dashboard");

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-8">
      {/* Hero Section */}
      <section className="relative w-full h-[320px] rounded-3xl overflow-hidden mb-12 glass-panel border-white/20">
        <img 
          src="https://images.unsplash.com/photo-1614729939124-032f0b56c9ce?q=80&w=2000&auto=format&fit=crop" 
          alt="Hero Background" 
          className="absolute inset-0 w-full h-full object-cover opacity-40 mix-blend-overlay"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[rgba(10,5,24,0.9)] via-[rgba(10,5,24,0.6)] to-transparent" />
        
        <div className="relative h-full flex flex-col justify-center px-12 max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[rgba(168,85,247,0.2)] border border-[rgba(168,85,247,0.4)] text-[rgba(216,180,254,1)] text-sm font-medium mb-4 w-max">
            <Zap className="w-4 h-4" />
            全新引擎 v2.0 上线
          </div>
          <h1 className="text-4xl md:text-6xl font-bold text-white mb-4 tracking-tight">
            探索由 <span className="text-transparent bg-clip-text bg-gradient-to-r from-[rgba(168,85,247,1)] to-[rgba(56,189,248,1)]">AI 驱动</span> 的无限故事宇宙
          </h1>
          <p className="text-lg text-gray-300 mb-8 max-w-xl">
            在这里，你的每一个选择都将改变世界走向。沉浸在数以万计的创作者构建的交互式叙事体验中。
          </p>
          <div className="flex items-center gap-4">
            <button className="px-8 py-3 rounded-xl bg-gradient-to-r from-[rgba(168,85,247,1)] to-[rgba(126,34,206,1)] text-white font-medium hover:shadow-custom transition-all duration-300">
              开始探索
            </button>
            <button className="px-8 py-3 rounded-xl bg-white/5 border border-white/10 text-white font-medium hover:bg-white/10 transition-all duration-300">
              了解更多
            </button>
          </div>
        </div>
      </section>

      {/* Main Content Area */}
      <div className="flex flex-col md:flex-row gap-8">
        
        {/* Left Sidebar - Categories */}
        <div className="w-full md:w-64 flex-shrink-0 space-y-6">
          <div className="glass-panel p-5">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Filter className="w-4 h-4" /> 分类
            </h3>
            <ul className="space-y-2">
              {['全部推荐', '赛博朋克', '未来科幻', '悬疑推理', '异星恋爱', '末日求生'].map((cat, idx) => (
                <li key={idx}>
                  <button className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                    idx === 0 
                      ? 'bg-[rgba(168,85,247,0.15)] text-[rgba(216,180,254,1)] font-medium' 
                      : 'text-gray-400 hover:bg-white/5 hover:text-white'
                  }`}>
                    {cat}
                    {idx === 0 && <Sparkles className="w-3.5 h-3.5" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          
          <div className="glass-panel p-5">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4" /> 热门榜单
            </h3>
            <div className="space-y-4">
              {[1, 2, 3].map((rank) => (
                <div key={rank} className="flex items-center gap-3 group cursor-pointer">
                  <div className={`w-6 h-6 flex justify-center items-center rounded-md font-bold text-xs ${
                    rank === 1 ? 'bg-yellow-500/20 text-yellow-500' :
                    rank === 2 ? 'bg-gray-300/20 text-gray-300' :
                    'bg-orange-500/20 text-orange-500'
                  }`}>
                    {rank}
                  </div>
                  <div>
                    <h4 className="text-sm text-white group-hover:text-[rgba(168,85,247,1)] transition-colors line-clamp-1">深空余音 (Echoes)</h4>
                    <p className="text-xs text-muted-foreground">98K 游玩</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Story Grid */}
        <div className="flex-1">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-[rgba(168,85,247,1)]" />
              为你推荐
            </h2>
            <div className="flex gap-2">
              <button className="px-4 py-1.5 rounded-lg text-sm bg-white/10 text-white font-medium">最新</button>
              <button className="px-4 py-1.5 rounded-lg text-sm bg-transparent text-gray-400 hover:bg-white/5">最热</button>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <StoryCard />
            <StoryCard 
              title="Stellar Heart: 星海彼端" 
              category="异星恋爱" 
              imageUrl="https://images.unsplash.com/photo-1534447677768-be436bb09401?q=80&w=800&auto=format&fit=crop"
              tags={["感情线", "自由对话", "星际"]}
            />
            <StoryCard 
              title="代码深渊 (The Code Abyss)" 
              category="悬疑推理" 
              imageUrl="https://images.unsplash.com/photo-1550751827-4bd374c3f58b?q=80&w=800&auto=format&fit=crop"
              tags={["解谜", "黑客", "硬核"]}
            />
            <StoryCard 
              title="Project: Eden" 
              category="末日求生" 
              imageUrl="https://images.unsplash.com/photo-1478760329108-5c3ed9d495a0?q=80&w=800&auto=format&fit=crop"
              tags={["生存", "资源管理", "人性"]}
            />
            <StoryCard 
              title="机甲核心 - Core Override" 
              category="未来科幻" 
              imageUrl="https://images.unsplash.com/photo-1589149098258-3e9102cd63d3?q=80&w=800&auto=format&fit=crop"
              tags={["战斗", "机甲改装", "史诗"]}
            />
            <StoryCard 
              title="虚拟幻境 (Virtual Mirage)" 
              category="赛博朋克" 
              imageUrl="https://images.unsplash.com/photo-1515630278258-407f66498911?q=80&w=800&auto=format&fit=crop"
              tags={["意识上传", "AI生成", "迷宫"]}
            />
          </div>
          
          <div className="mt-12 flex justify-center">
            <button className="px-6 py-2.5 rounded-xl border border-white/10 bg-white/5 text-white hover:bg-white/10 transition-colors">
              加载更多内容
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Community;