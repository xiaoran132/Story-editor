import React from 'react';
import { Wallet, TrendingUp, Users, Coins, ArrowUpRight, Crown, Gift, BarChart } from 'lucide-react';

const Monetization: React.FC = () => {
  console.log("Rendering Monetization Dashboard");

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-8">
      
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">收益与数据中心</h1>
          <p className="text-muted-foreground mt-1">管理你的创作收益、粉丝数据与代币资产</p>
        </div>
        <button className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-[rgba(56,189,248,1)] to-[rgba(168,85,247,1)] text-white font-medium hover:shadow-custom transition-all">
          <Wallet className="w-5 h-5" />
          提现到钱包
        </button>
      </div>

      {/* Main Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        
        {/* Total Revenue */}
        <div className="glass-panel p-6 border-t-4 border-t-[rgba(168,85,247,1)]">
          <div className="flex justify-between items-start mb-4">
            <div className="w-10 h-10 rounded-lg bg-[rgba(168,85,247,0.1)] flex items-center justify-center">
              <Coins className="w-5 h-5 text-[rgba(168,85,247,1)]" />
            </div>
            <span className="flex items-center gap-1 text-xs font-medium text-[rgba(34,197,94,1)] bg-[rgba(34,197,94,0.1)] px-2 py-1 rounded">
              <TrendingUp className="w-3 h-3" /> +12.5%
            </span>
          </div>
          <h3 className="text-gray-400 text-sm font-medium mb-1">本月总收益 (NXC)</h3>
          <p className="text-3xl font-bold text-white">42,500 <span className="text-lg text-muted-foreground">NXC</span></p>
          <p className="text-xs text-muted-foreground mt-2">≈ $4,250.00 USD</p>
        </div>

        {/* Active Subscribers */}
        <div className="glass-panel p-6 border-t-4 border-t-[rgba(56,189,248,1)]">
          <div className="flex justify-between items-start mb-4">
            <div className="w-10 h-10 rounded-lg bg-[rgba(56,189,248,0.1)] flex items-center justify-center">
              <Crown className="w-5 h-5 text-[rgba(56,189,248,1)]" />
            </div>
            <span className="flex items-center gap-1 text-xs font-medium text-[rgba(34,197,94,1)] bg-[rgba(34,197,94,0.1)] px-2 py-1 rounded">
              <TrendingUp className="w-3 h-3" /> +8.2%
            </span>
          </div>
          <h3 className="text-gray-400 text-sm font-medium mb-1">活跃付费订阅</h3>
          <p className="text-3xl font-bold text-white">1,284</p>
          <p className="text-xs text-muted-foreground mt-2">较上月新增 120 人</p>
        </div>

        {/* Total Plays */}
        <div className="glass-panel p-6">
          <div className="flex justify-between items-start mb-4">
            <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center">
              <Users className="w-5 h-5 text-gray-300" />
            </div>
          </div>
          <h3 className="text-gray-400 text-sm font-medium mb-1">作品总游玩次数</h3>
          <p className="text-3xl font-bold text-white">3.2M</p>
          <p className="text-xs text-muted-foreground mt-2">《霓虹阴影》贡献了 60%</p>
        </div>
        
        {/* Token Rewards */}
        <div className="glass-panel p-6 relative overflow-hidden group">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-[rgba(234,179,8,0.1)] rounded-full blur-xl group-hover:bg-[rgba(234,179,8,0.2)] transition-colors" />
          <div className="flex justify-between items-start mb-4 relative z-10">
            <div className="w-10 h-10 rounded-lg bg-[rgba(234,179,8,0.1)] flex items-center justify-center">
              <Gift className="w-5 h-5 text-[rgba(234,179,8,1)]" />
            </div>
          </div>
          <h3 className="text-gray-400 text-sm font-medium mb-1 relative z-10">待领取平台激励</h3>
          <p className="text-3xl font-bold text-[rgba(234,179,8,1)] relative z-10">1,500</p>
          <button className="mt-3 text-xs text-white bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded transition-colors relative z-10">
            立即领取
          </button>
        </div>

      </div>

      {/* Two Column Layout for details */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Chart Area */}
        <div className="lg:col-span-2 glass-panel p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <BarChart className="w-5 h-5 text-[rgba(168,85,247,1)]" />
              近 30 天收益趋势
            </h3>
            <select className="bg-white/5 border border-white/10 text-sm text-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-[rgba(168,85,247,0.5)]">
              <option>NXC 代币</option>
              <option>USD 法币</option>
            </select>
          </div>
          <div className="w-full h-64 bg-gradient-to-t from-[rgba(168,85,247,0.05)] to-transparent rounded-xl border border-white/5 flex items-end px-4 gap-2 pb-0 pt-4">
            {/* Pseudo Bar Chart for UI Demo */}
            {[40, 60, 45, 80, 65, 50, 70, 90, 85, 100, 75, 60, 55, 70].map((height, i) => (
              <div key={i} className="flex-1 bg-gradient-to-t from-[rgba(168,85,247,0.8)] to-[rgba(56,189,248,0.8)] rounded-t-sm opacity-80 hover:opacity-100 transition-opacity relative group" style={{ height: `${height}%` }}>
                <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-[rgba(10,5,24,0.9)] border border-white/10 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity text-white pointer-events-none whitespace-nowrap">
                  {height * 10} NXC
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Transactions */}
        <div className="glass-panel p-6 flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-white">最新交易明细</h3>
            <button className="text-sm text-[rgba(56,189,248,1)] hover:text-white transition-colors">查看全部</button>
          </div>
          
          <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar">
            {[
              { type: '会员订阅', user: 'CyberNinja_X', amount: '+50 NXC', date: '2 分钟前', color: 'text-[rgba(34,197,94,1)]' },
              { type: '单集解锁', user: 'Alice_2049', amount: '+15 NXC', date: '15 分钟前', color: 'text-[rgba(34,197,94,1)]' },
              { type: '平台激励', user: 'System', amount: '+500 NXC', date: '2 小时前', color: 'text-[rgba(234,179,8,1)]' },
              { type: '收益提现', user: 'External Wallet', amount: '-10,000 NXC', date: '昨天', color: 'text-white' },
              { type: '会员订阅', user: 'Neo_Matrix', amount: '+50 NXC', date: '昨天', color: 'text-[rgba(34,197,94,1)]' },
            ].map((tx, idx) => (
              <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[rgba(255,255,255,0.1)] to-[rgba(255,255,255,0.05)] flex items-center justify-center border border-white/10">
                    {tx.amount.startsWith('-') ? <ArrowUpRight className="w-4 h-4 text-gray-400" /> : <TrendingUp className="w-4 h-4 text-[rgba(34,197,94,1)]" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{tx.type}</p>
                    <p className="text-xs text-muted-foreground">{tx.user}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-bold ${tx.color}`}>{tx.amount}</p>
                  <p className="text-xs text-muted-foreground">{tx.date}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

    </div>
  );
};

export default Monetization;