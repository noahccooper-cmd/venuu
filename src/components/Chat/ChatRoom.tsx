import { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';
import { ChatBubble } from './ChatBubble';
import type { ChatMessage } from '../../lib/types';

interface ChatRoomProps {
  messages: ChatMessage[];
  loading: boolean;
  userId?: string;
  username?: string;
  isLoggedIn: boolean;
  onSend: (body: string) => Promise<void>;
  onLoginRequired: () => void;
}

export function ChatRoom({ messages, loading, userId, isLoggedIn, onSend, onLoginRequired }: ChatRoomProps) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!isLoggedIn) {
      onLoginRequired();
      return;
    }
    const text = body.trim();
    if (!text || sending) return;

    setSending(true);
    setBody('');
    await onSend(text);
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {loading && (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-[#FF5E1A] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-[#55555F] text-sm" style={{ fontFamily: 'Satoshi, sans-serif' }}>
              No messages yet tonight.
            </p>
            <p className="text-[#55555F] text-xs mt-1" style={{ fontFamily: 'Satoshi, sans-serif' }}>
              Be the first to say something.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <ChatBubble
            key={msg.id}
            message={msg}
            isOwn={msg.user_id === userId}
          />
        ))}
      </div>

      {/* Input */}
      <div className="border-t border-[#2A2A30] px-4 py-3 bg-[#050507]">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 280))}
            onKeyDown={handleKeyDown}
            placeholder={isLoggedIn ? "What's the move tonight?" : 'Sign in to chat'}
            className="flex-1 h-11 px-4 bg-[#111114] border border-[#2A2A30] rounded-full text-white text-sm placeholder-[#55555F] outline-none focus:border-[#FF5E1A] transition-colors"
            style={{ fontFamily: 'Satoshi, sans-serif' }}
            disabled={!isLoggedIn}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!body.trim() || sending}
            className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-90 disabled:opacity-40"
            style={{ background: '#FF8200', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
          >
            <Send size={18} strokeWidth={1.5} className="text-white ml-0.5" />
          </button>
        </div>
        {body.length > 200 && (
          <div className="text-right mt-1">
            <span className={`text-xs ${body.length > 260 ? 'text-[#FF2D05]' : 'text-[#55555F]'}`}
              style={{ fontFamily: 'Satoshi, sans-serif' }}>
              {body.length}/280
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
