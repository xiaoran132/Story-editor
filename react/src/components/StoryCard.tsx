import React from 'react';
import { Play, Heart, Eye, MoreHorizontal } from 'lucide-react';

interface StoryCardProps {
  title?: string;
  author?: string;
  category?: string;
  views?: string;
  likes?: string;
  imageUrl?: string;
  tags?: string[];
}

const StoryCard: React.FC<StoryCardProps> = ({
  title = "Neon Shadows: Tokyo 2088",
  author = "CyberWriter",
  category = "科幻推理",
  views = "124K",
  likes = "45K",
  imageUrl = "https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?q=80&w=800&auto=format&fit=crop",
  tags = ["多分支", "AI动态生成", "赛博朋克"]
}) => {
  return (
    <div data-cmp="StoryCard" className="group glass-panel overflow-hidden transition-all duration-500 hover:-translate-y-2 hover:shadow-custom cursor-pointer">
      <div className="relative h-56 overflow-hidden">
        <img 
          src={imageUrl} 
          alt={title} 
          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110 opacity-80 group-hover:opacity-100"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[rgba(10,5,24,1)] via-[rgba(10,5,24,0.4)] to-transparent" />
        
        {/* Category Badge */}
        <div className="absolute top-4 left-4 px-3 py-1 rounded-full bg-[rgba(10,5,24,0.6)] backdrop-blur-md border border-white/10 text-xs font-medium text-[rgba(56,189,248,1)] flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[rgba(56,189,248,1)] animate-pulse"></span>
          {category}
        </div>

        {/* Play Button Overlay */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <div className="w-14 h-14 rounded-full bg-[rgba(168,85,247,0.8)] backdrop-blur-md flex items-center justify-center shadow-[0_0_20px_rgba(168,85,247,0.6)] pl-1">
            <Play className="w-6 h-6 text-white" />
          </div>
        </div>
      </div>

      <div className="p-5">
        <div className="flex justify-between items-start mb-2">
          <h3 className="text-xl font-bold text-white group-hover:text-[rgba(216,180,254,1)] transition-colors line-clamp-1">{title}</h3>
          <button className="text-muted-foreground hover:text-white transition-colors">
            <MoreHorizontal className="w-5 h-5" />
          </button>
        </div>
        
        <p className="text-sm text-muted-foreground mb-4">By <span className="text-white hover:text-[rgba(56,189,248,1)] transition-colors">{author}</span></p>
        
        <div className="flex flex-wrap gap-2 mb-5">
          {tags.map((tag, i) => (
            <span key={i} className="text-xs px-2.5 py-1 rounded-md bg-white/5 border border-white/5 text-gray-300">
              {tag}
            </span>
          ))}
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-white/5">
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5 hover:text-white transition-colors">
              <Eye className="w-4 h-4" />
              <span>{views}</span>
            </div>
            <div className="flex items-center gap-1.5 hover:text-[rgba(239,68,68,1)] transition-colors">
              <Heart className="w-4 h-4" />
              <span>{likes}</span>
            </div>
          </div>
          <button className="text-sm font-medium text-[rgba(168,85,247,1)] group-hover:text-[rgba(216,180,254,1)] transition-colors flex items-center gap-1">
            开始体验
            <Play className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default StoryCard;