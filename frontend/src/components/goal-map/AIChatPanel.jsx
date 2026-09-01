import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { advisor } from '@/api/kb';
import { Button } from '@/components/ui/button';
import { X, Send, Loader2, MessageSquare, Undo2 } from 'lucide-react';
import OperationsCard from './OperationsCard';

export default function AIChatPanel({ open, onClose, mapTitle, nodes, edges, onApplyOperations, onUndoAi, canUndoAi }) {
  const { t } = useTranslation('editor');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 128) + 'px';
    }
  }, [input]);

  const serializeMap = () => {
    const parentMap = {};
    for (const edge of edges) {
      parentMap[edge.target] = edge.source;
    }
    return {
      title: mapTitle || '',
      nodes: nodes.map((n) => ({
        id: n.id,
        title: n.data?.title || n.data?.apexText || '',
        description: n.data?.description || '',
        status: n.data?.status || 'todo',
        parentId: parentMap[n.id] || null,
      })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    };
  };

  const handleSend = async (textArg) => {
    const text = (textArg ?? input).trim();
    if (!text || loading) return;

    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setInput('');
    setLoading(true);

    try {
      const data = await advisor({
        mode: 'chat',
        message: text,
        map: serializeMap(),
      });
      if (data?.error) {
        setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ ${data.error}` }]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: data.reply || t('aiChat.emptyReply'),
            operations: Array.isArray(data.operations) ? data.operations : [],
          },
        ]);
      }
    } catch (err) {
      const msg = err.response?.error || err.message || t('aiChat.connectionError');
      setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ ${msg}` }]);
    } finally {
      setLoading(false);
    }
  };

  const quickPrompts = [t('aiChat.quickSuggest'), t('aiChat.quickMissing'), t('aiChat.quickSimplify')];

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickPrompt = (prompt) => {
    setInput('');
    handleSend(prompt);
  };

  const handleApply = (msgIndex, operations) => {
    onApplyOperations(operations);
    setMessages((prev) => prev.map((m, i) => (i === msgIndex ? { ...m, operationsApplied: true } : m)));
  };

  const handleDiscard = (msgIndex) => {
    setMessages((prev) => prev.map((m, i) => (i === msgIndex ? { ...m, operationsDiscarded: true } : m)));
  };

  if (!open) return null;

  return (
    <div className="absolute right-0 top-0 bottom-0 w-full sm:w-96 bg-card border-l shadow-xl flex flex-col z-20">
      <div className="h-12 border-b flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" />
          <span className="font-heading font-semibold text-sm">{t('toolbar.aiChat')}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2"
            onClick={onUndoAi}
            disabled={!canUndoAi}
            title={t('aiChat.undoTitle')}
          >
            <Undo2 className="w-3.5 h-3.5" />
            {t('toolbar.undoTitle')}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-muted-foreground text-sm py-8">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p>{t('aiChat.emptyTitle')}</p>
            <p className="text-xs mt-1">{t('aiChat.emptyHint')}</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
              }`}
            >
              <p className="whitespace-pre-wrap break-words">{msg.content}</p>
              {msg.operations && msg.operations.length > 0 && !msg.operationsApplied && !msg.operationsDiscarded && (
                <OperationsCard
                  operations={msg.operations}
                  nodes={nodes}
                  onApply={() => handleApply(i, msg.operations)}
                  onDiscard={() => handleDiscard(i)}
                />
              )}
              {msg.operationsApplied && (
                <p className="mt-2 text-xs text-green-600 font-medium">{t('aiChat.applied')}</p>
              )}
              {msg.operationsDiscarded && (
                <p className="mt-2 text-xs text-muted-foreground font-medium">{t('aiChat.discarded')}</p>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-secondary rounded-lg px-3 py-2 flex items-center gap-2 text-sm">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span className="text-muted-foreground">{t('aiChat.thinking')}</span>
            </div>
          </div>
        )}
      </div>

      <div className="border-t p-3 shrink-0 space-y-2">
        <div className="flex gap-1.5 flex-wrap">
          {quickPrompts.map((prompt) => (
            <button
              key={prompt}
              onClick={() => handleQuickPrompt(prompt)}
              disabled={loading}
              className="text-xs font-medium px-2.5 py-1 rounded-full border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50"
            >
              {prompt}
            </button>
          ))}
        </div>
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('aiChat.inputPlaceholder')}
            rows={1}
            className="flex-1 resize-none rounded-md border border-input bg-background text-sm px-3 py-2 outline-none focus:ring-2 focus:ring-ring max-h-32"
            disabled={loading}
          />
          <Button size="icon" onClick={() => handleSend()} disabled={loading || !input.trim()}>
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}