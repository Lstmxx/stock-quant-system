import React from 'react';
import { Outlet } from 'react-router-dom';
import { Activity, ArrowUpRight, Orbit } from 'lucide-react';

const AuthLayout: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <main className="auth-canvas">
    <div className="auth-grid" />
    <div className="auth-orbit auth-orbit-one"><Orbit size={250} strokeWidth={0.5} /></div>
    <div className="auth-orbit auth-orbit-two"><Orbit size={170} strokeWidth={0.5} /></div>
    <header className="auth-brand"><span className="brand-symbol"><Activity size={20} /></span><span>STOCK<span>QUANT</span></span><span className="auth-index">/ 01</span></header>
    <div className="auth-meta auth-meta-top">QUANTITATIVE RESEARCH<br />OPERATING SYSTEM</div>
    <div className="auth-meta auth-meta-bottom">09:41:28 CST<br /><span>MARKET OPEN</span></div>
    <section className="auth-content">{children || <Outlet />}</section>
    <div className="auth-corner auth-corner-left">SQ—AUTH / SECURE CHANNEL</div>
    <div className="auth-corner auth-corner-right"><ArrowUpRight size={14} /> SIGNALS OVER NOISE</div>
  </main>
);

export default AuthLayout;
