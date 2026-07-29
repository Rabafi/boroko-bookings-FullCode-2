import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Search } from 'lucide-react'

export default function HposCommandPalette({ open, onClose, commands, onSelect }) {
  const [query,setQuery]=useState(''); const inputRef=useRef(null)
  useEffect(()=>{if(open){setQuery('');setTimeout(()=>inputRef.current?.focus(),0)}},[open])
  useEffect(()=>{if(!open)return;const handler=e=>{if(e.key==='Escape')onClose();if(e.key==='Enter'){const first=commands.find(c=>`${c.label} ${c.keywords||''}`.toLowerCase().includes(query.toLowerCase()));if(first)onSelect(first)}};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler)},[open,query,commands,onClose,onSelect])
  const filtered=useMemo(()=>commands.filter(c=>`${c.label} ${c.group||''} ${c.keywords||''}`.toLowerCase().includes(query.toLowerCase())).slice(0,12),[commands,query])
  if(!open)return null
  return <div className="hpos-command-backdrop" onMouseDown={onClose}><section className="hpos-command" role="dialog" aria-modal="true" aria-label="Search Tsa Bonno Restaurant and Bar POS" onMouseDown={e=>e.stopPropagation()}><div className="hpos-command-search"><Search size={19}/><input ref={inputRef} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Go to a workspace or start an action…" aria-label="Search commands"/><kbd>Esc</kbd></div><div className="hpos-command-results">{filtered.map((command,index)=><button key={`${command.route}-${command.label}`} className={index===0?'is-first':''} onClick={()=>onSelect(command)}><span><small>{command.group || 'Workspace'}</small><strong>{command.label}</strong></span>{command.badge!=null&&<em>{command.badge}</em>}<ArrowRight size={15}/></button>)}{!filtered.length&&<p>No matching workspace or action.</p>}</div><footer><span>↵ Open first result</span><span>Ctrl/⌘ K Search anywhere</span></footer></section></div>
}
