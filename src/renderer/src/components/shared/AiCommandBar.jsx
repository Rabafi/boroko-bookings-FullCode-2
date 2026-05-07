import { useState, useRef, useEffect, useMemo } from 'react'
import { Users, DollarSign, TrendingUp, ArrowRight, CheckCircle, XCircle, AlertTriangle, ClipboardList, BarChart3, Package, ShoppingCart, Lock, Info, CalendarCheck, Clock, CreditCard, Tag, Globe, Boxes, Presentation, Waves, BookOpen, Receipt } from 'lucide-react'

export default function AiCommandBar({ currency = 'R', stats }) {
  const [isOpen, setIsOpen] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef(null)
  
  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem('BOROKO_CHAT_HISTORY')
      if (!saved) return []
      return JSON.parse(saved).map(m => ({
        role: m.role, text: m.text || '', actionLabel: m.actionLabel || null, actionType: m.actionType || null, cardType: m.cardType || null, payload: m.payload || null
      }))
    } catch(e) { return [] }
  })

  const [workingModel] = useState(() => localStorage.getItem('BOROKO_LAST_MODEL') || null)
  const [apiStatus] = useState('active')

  const inputRef = useRef(null); const scrollRef = useRef(null)

  useEffect(() => { 
     try { localStorage.setItem('BOROKO_CHAT_HISTORY', JSON.stringify(messages)) } catch(e) {}
  }, [messages])
  
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [messages, isTyping])

  const nudges = useMemo(() => {
    const list = []
    if (stats?.unpaid_count > 0) list.push({ icon: <AlertTriangle size={14}/>, text: `${stats.unpaid_count} Unpaid Bills.`, cmd: "Show unpaid bookings" })
    if (stats?.outstanding_total > 5000) list.push({ icon: <DollarSign size={14}/>, text: "High Outstanding Balance.", cmd: "Lodge financial audit" })
    return list.slice(0, 2)
  }, [stats])

  const toggleListening = () => {
    try {
      if (!recognitionRef.current) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
        if (!SpeechRecognition) return
        const rec = new SpeechRecognition()
        rec.onresult = (e) => { setQuery(e.results[0][0].transcript); setIsListening(false) }
        rec.onerror = () => setIsListening(false)
        rec.onend = () => setIsListening(false)
        recognitionRef.current = rec
      }
      if (isListening) { recognitionRef.current.stop(); setIsListening(false) }
      else { recognitionRef.current.start(); setIsListening(true) }
    } catch(e) { setIsListening(false) }
  }

  const processQuery = async (q) => {
    try {
      const snapshot = { s: stats, currency }
      const result = await window.api.ai.turn({ message: q, model: workingModel, snapshot }).catch(() => ({ success: false, error: 'AI offline.' }))
      if (!result?.success) {
        return [{ role: 'ai', text: result?.error || "Service temporarily offline." }]
      }

      const res = {
        role: 'ai',
        text: result.assistantText || '',
        actionLabel: null,
        actionType: null,
        cardType: result?.proposal ? 'AI_PROPOSAL' : (result?.toolResult ? 'AI_TOOL_RESULT' : null),
        payload: result?.proposal
          ? { proposal: result.proposal }
          : (result?.toolResult ? result.toolResult : null)
      }
      return [res]
    } catch(e) { return [{ role: 'ai', text: "Service temporarily offline." }] }
  }

  const executeProposal = async (proposal) => {
    setIsTyping(true)
    try {
      const result = await window.api.ai.execute({ proposalId: proposal.id })
      if (!result?.success) throw new Error(result?.error || 'Action failed')
      setMessages(prev => [...prev, { role: 'ai', text: `Done. ${proposal.tool.replace(/_/g, ' ')} completed.`, actionLabel: "Action Completed", actionType: "AI_ACTION" }])
    } catch (e) {
      setMessages(prev => [...prev, { role: 'ai', text: `Could not complete that action: ${e.message || 'Unknown error'}` }])
    } finally {
      setIsTyping(false)
    }
  }

  const renderCard = (m) => {
    if (m.cardType === 'AI_PROPOSAL' && m.payload?.proposal) {
       const p = m.payload.proposal
       return (
         <div className="p-4 bg-slate-900 text-white rounded-2xl border border-white/10 shadow-xl">
            <div className="flex items-center gap-2 mb-3 text-emerald-400 font-bold text-[10px] uppercase tracking-widest"><CalendarCheck size={14} /> Action Ready</div>
            <div className="space-y-2 mb-4 text-xs opacity-90">
               <p><span className="opacity-50">Tool:</span> {p.tool}</p>
               <p className="break-words"><span className="opacity-50">Params:</span> {JSON.stringify(p.params || {})}</p>
            </div>
            <button onClick={() => executeProposal(p)} className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-[10px] font-bold uppercase transition-all shadow-lg shadow-emerald-600/20">Confirm & Execute</button>
         </div>
       )
    }
    if (m.cardType === 'AI_TOOL_RESULT' && m.payload?.tool) {
      return (
        <div className="p-4 bg-slate-900 text-white rounded-2xl border border-white/10 shadow-xl">
          <div className="flex items-center gap-2 mb-3 text-sky-300 font-bold text-[10px] uppercase tracking-widest"><Info size={14} /> Live Result</div>
          <div className="text-xs opacity-90 break-words whitespace-pre-wrap">{JSON.stringify(m.payload.result || {}, null, 2)}</div>
        </div>
      )
    }
    return null
  }

  const handleSend = async (manual) => {
    const q = typeof manual === 'string' ? manual : query
    if (!q.trim() || isTyping) return
    setQuery(''); setMessages(prev => [...prev, { role: 'user', text: q }]); setIsTyping(true)
    const res = await processQuery(q); setIsTyping(false)
    res.forEach(m => setMessages(prev => [...prev, m]))
  }

  return (
    <div className="relative w-full max-w-lg z-50">
      <div onClick={() => { setIsOpen(true); setTimeout(() => inputRef.current?.focus(), 100) }} className="flex items-center w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 cursor-pointer shadow-sm hover:shadow-md transition-all">
         <TrendingUp size={16} className="text-emerald-500 mr-3" />
         <div className="flex-1 text-[10px] text-slate-400 font-bold uppercase tracking-widest">Consult Boroko AI...</div>
         <div className={`w-1.5 h-1.5 rounded-full ${apiStatus === 'active' ? 'bg-emerald-500' : 'bg-amber-500'} animate-pulse`} />
      </div>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/5" onClick={() => setIsOpen(false)} />
          <div className={`transition-all z-50 flex flex-col bg-white dark:bg-slate-950 shadow-2xl border border-slate-200 dark:border-slate-800 ${isExpanded ? 'fixed top-6 left-6 right-6 bottom-6 rounded-3xl' : 'absolute top-full right-0 w-[500px] h-[600px] mt-3 rounded-2xl overflow-hidden'}`}>
            <div className="px-6 py-5 border-b dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900">
               <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20"><Users size={20} /></div><div><p className="text-xs font-black dark:text-white uppercase tracking-tighter">Boroko Ops AI</p><p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Tool-Safe Agent</p></div></div>
               <div className="flex items-center gap-1">
                  <button onClick={() => setIsExpanded(!isExpanded)} className="p-2.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all"><TrendingUp size={18} /></button>
                  <button onClick={() => setIsOpen(false)} className="p-2.5 text-slate-400 hover:bg-rose-50 rounded-xl ml-1"><XCircle size={18} /></button>
               </div>
            </div>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 bg-white dark:bg-slate-950 no-scrollbar">
               {messages.length === 0 && nudges.map((n, i) => (
                  <div key={i} onClick={() => handleSend(n.cmd)} className="p-4 bg-emerald-50 dark:bg-emerald-950 border border-emerald-100 dark:border-emerald-900 rounded-xl flex items-center gap-3 cursor-pointer hover:scale-[1.02] transition-all">
                     <div className="text-emerald-600">{n.icon}</div>
                     <p className="text-xs font-bold text-slate-700 dark:text-slate-200 flex-1">{n.text}</p>
                     <ArrowRight size={14} className="text-emerald-400" />
                  </div>
               ))}
               {messages.map((m, idx) => (
                  <div key={idx} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                     <div className={`w-8 h-8 rounded flex items-center justify-center ${m.role === 'user' ? 'bg-slate-800 text-white' : 'bg-emerald-50 text-emerald-600'}`}>{m.role === 'user' ? <Users size={16} /> : <Users size={16} />}</div>
                     <div className={`max-w-[85%] p-4 rounded-xl text-xs leading-relaxed ${m.role === 'user' ? 'bg-emerald-600 text-white rounded-tr-none shadow-md' : 'bg-slate-50 dark:bg-slate-900 dark:text-white border dark:border-slate-800'}`}>
                        {m.text}
                        {m.cardType && <div className="mt-3">{renderCard(m)}</div>}
                        {m.actionLabel && <div className="mt-3 flex items-center gap-2 text-emerald-600 font-bold uppercase text-[9px] px-2 py-1 bg-emerald-50 dark:bg-emerald-950 rounded-lg"><CheckCircle size={12} /> {m.actionLabel}</div>}
                     </div>
                  </div>
               ))}
            </div>
            <div className="p-4 border-t dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
                <form onSubmit={(e) => { e.preventDefault(); handleSend() }} className="flex gap-2">
                   <div className="relative flex-1">
                      <input ref={inputRef} type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type command..." className="w-full p-3 pr-12 border dark:border-slate-700 rounded-xl text-xs dark:bg-slate-800 dark:text-white outline-none" />
                      <button type="button" onClick={toggleListening} className={`absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-all ${isListening ? 'bg-rose-500 text-white animate-pulse' : 'text-slate-400 hover:text-emerald-600'}`}><Waves size={18} /></button>
                   </div>
                   <button type="submit" className="bg-emerald-600 text-white px-5 py-2 rounded-xl text-[10px] font-black uppercase shadow-lg shadow-emerald-600/20 active:scale-95 transition-all">Send</button>
                </form>
             </div>
          </div>
        </>
      )}
    </div>
  )
}
