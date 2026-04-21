import React, { useState } from 'react';
import { Mic, Volume2, Image as ImageIcon } from 'lucide-react';

// Chat interface with large typography and obvious voice controls
const Chat: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);

  const messages = [
    {
      id: 1,
      sender: 'ai',
      text: '李爷爷您好！今天天气不错，您早上吃过饭了吗？',
      time: '08:30'
    },
    {
      id: 2,
      sender: 'user',
      text: '吃过啦，喝了点粥。',
      time: '08:32'
    },
    {
      id: 3,
      sender: 'ai',
      text: '喝粥养胃，挺好的。等下太阳出来了，您可以去楼下花园转转，活动一下筋骨。',
      time: '08:33'
    }
  ];

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border p-6 shadow-sm flex items-center justify-between z-10">
        <h2 className="text-3xl font-bold text-foreground">维塔陪您聊天</h2>
        <div className="px-4 py-2 bg-green-100 text-green-700 rounded-full text-xl font-bold">
          维塔在线中
        </div>
      </header>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-8 flex flex-col gap-8">
        {messages.map((msg) => (
          <div 
            key={msg.id} 
            className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`flex gap-4 max-w-[70%] ${msg.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              
              {/* Avatar */}
              <div className={`w-16 h-16 rounded-full flex-shrink-0 flex items-center justify-center text-2xl font-bold ${
                msg.sender === 'ai' ? 'bg-primary text-white' : 'bg-blue-500 text-white'
              }`}>
                {msg.sender === 'ai' ? '暖' : '我'}
              </div>

              {/* Message Bubble */}
              <div className="flex flex-col gap-2">
                <div className={`p-6 rounded-[2rem] text-3xl leading-relaxed shadow-sm ${
                  msg.sender === 'ai' 
                    ? 'bg-card border-2 border-border rounded-tl-none' 
                    : 'bg-primary text-primary-foreground rounded-tr-none'
                }`}>
                  {msg.text}
                </div>
                
                {/* Controls for AI messages */}
                {msg.sender === 'ai' && (
                  <button className="flex items-center gap-2 text-primary hover:bg-primary/10 px-4 py-2 rounded-xl w-fit transition-colors">
                    <Volume2 size={28} />
                    <span className="text-xl font-bold">朗读这句话</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Bottom Input Area */}
      <div className="bg-card border-t border-border p-8 shadow-[0_-10px_30px_rgba(0,0,0,0.05)]">
        <div className="max-w-4xl mx-auto flex items-center gap-6">
          <button className="w-20 h-20 bg-secondary rounded-full flex items-center justify-center text-primary hover:bg-secondary/80 transition-colors">
            <ImageIcon size={40} />
          </button>
          
          <button 
            onMouseDown={() => setIsRecording(true)}
            onMouseUp={() => setIsRecording(false)}
            onMouseLeave={() => setIsRecording(false)}
            className={`flex-1 h-24 rounded-full flex items-center justify-center gap-4 transition-all ${
              isRecording 
                ? 'bg-primary scale-[0.98] shadow-inner text-white' 
                : 'bg-gradient-to-r from-primary to-orange-400 text-white shadow-custom hover:scale-[1.02]'
            }`}
          >
            <Mic size={48} className={isRecording ? 'animate-bounce' : ''} />
            <span className="text-3xl font-bold tracking-widest">
              {isRecording ? '正在聆听，请说话...' : '按住说话'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Chat;