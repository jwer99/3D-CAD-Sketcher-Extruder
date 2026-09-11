import React, { useEffect, useState } from 'react';
import { ArrowUpRight, Box, Check, Heart, MoveUpRight, Sun, Moon } from 'lucide-react';
import { readTheme, applyTheme } from '../utils/theme';
import './services.css';

type Commerce = { salesEmail: string | null; supportUrl: string | null };
export default function ServicesPage() {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => applyTheme(theme), [theme]);
  const [config, setConfig] = useState<Commerce | null>(null);
  const [failed, setFailed] = useState(false);
  const [service, setService] = useState('Custom 3D Part Modeling');
  const [brief, setBrief] = useState('');
  useEffect(() => {
    document.title = 'CAD Services & Project Support | VOXEL3D';
    const controller = new AbortController();
    fetch('/api/commerce', { signal: controller.signal }).then(r => {
      if (!r.ok) throw new Error('Configuration unavailable');
      return r.json();
    }).then(setConfig).catch(e => { if (e.name !== 'AbortError') setFailed(true); });
    return () => controller.abort();
  }, []);
  const mailto = config?.salesEmail ? `mailto:${encodeURIComponent(config.salesEmail)}?subject=${encodeURIComponent(`CAD Quote Request — ${service}`)}&body=${encodeURIComponent(`Service: ${service}\n\n${brief}\n\nDesired delivery format:\nDesired timeline:\nApproximate budget:\n`)}` : null;
  return <div className="services-page">
    <nav className="services-nav" aria-label="Main navigation"><a className="services-brand" href="/"><span className="services-logo">V</span> VOXEL3D <span>CAD</span></a><span className="services-nav-label">SERVICES & SUPPORT</span><div className="services-nav-actions"><button className="services-outline services-theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle Theme">{theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}</button><a href="/" className="services-primary">Open editor <ArrowUpRight size={14} /></a></div></nav>
    <main>
      <section className="services-hero">
        <div><p className="services-eyebrow">FROM SKETCH TO PART</p><h1>Your next idea.<br /><em>In three dimensions.</em></h1><p className="services-intro">Design in your browser with VOXEL3D. Need help moving forward? Request custom 3D modeling for your part.</p><div className="services-actions"><a className="services-primary" href="/">Design for free <ArrowUpRight size={18} /></a><a className="services-outline" href="#presupuesto">Request a project</a></div><p className="services-note">2D Sketches · Extrude & Revolve · STEP, STL & OBJ</p></div>
        <div className="services-art" aria-hidden="true"><div className="services-orbit" /><div className="services-cube"><Box size={150} strokeWidth={0.65} /></div><span className="services-art-label">IDEA → SKETCH → SOLID</span><span className="services-dimension">X / Y / Z &nbsp; · &nbsp; mm</span></div>
      </section>
      <section className="services-options" aria-labelledby="options-title"><p className="services-eyebrow">CHOOSE HOW TO PROCEED</p><h2 id="options-title">One tool. Three ways to participate.</h2><div className="services-grid">
        <article className="services-card"><Box /><h3>Do it yourself</h3><p>Explore your ideas directly in the browser CAD editor.</p><strong>Free</strong><ul><li><Check /> 2D sketches & 3D modeling features</li><li><Check /> STEP, STL and OBJ file import</li><li><Check /> Geometric solid export</li></ul><a className="services-outline" href="/">Open editor <ArrowUpRight size={16} /></a></article>
        <article className="services-card services-featured"><MoveUpRight /><h3>Help with your part</h3><p>Tell us what you need to model, adapt, or convert.</p><strong>Custom quote</strong><ul><li><Check /> Describe the part and its dimensions</li><li><Check /> Specify desired format and timeline</li><li><Check /> Agree on scope and price before payment</li></ul><a className="services-primary" href="#presupuesto">Check availability <ArrowUpRight size={16} /></a></article>
        <article className="services-card"><Heart /><h3>Support VOXEL3D</h3><p>Contribute to ongoing development and server maintenance.</p><strong>Voluntary contribution</strong><ul><li><Check /> No locked paywalls or restricted features</li><li><Check /> Amount and details on checkout page</li><li><Check /> Does not include modeling services</li></ul>{config?.supportUrl ? <a className="services-outline" href={config.supportUrl} target="_blank" rel="noopener noreferrer">Support the project <ArrowUpRight size={16} /></a> : <p className="services-note" role="status">{failed ? 'Could not load support link. Reload the page.' : config ? 'Contributions are not yet enabled.' : 'Loading support options…'}</p>}</article>
      </div></section>
      <section id="presupuesto" className="services-contact"><div><p className="services-eyebrow">START WITH YOUR IDEA</p><h2>What do you need to create?</h2><p>Prepare your inquiry and send it via email. Availability, scope, price, and delivery are agreed upon before starting work.</p><p className="services-note">This form does not store your text on a server. Continuing opens your email client; send the message to submit your inquiry.</p></div><form onSubmit={e => { e.preventDefault(); if (mailto) window.location.href = mailto; }}><label htmlFor="service">Project type</label><select id="service" value={service} onChange={e => setService(e.target.value)}><option>Custom 3D Part Modeling</option><option>Existing Model Modification</option><option>CAD File Conversion / Repair</option><option>Other Inquiry</option></select><label htmlFor="brief">Describe your part</label><textarea id="brief" required minLength={20} maxLength={1500} rows={5} value={brief} onChange={e => setBrief(e.target.value)} placeholder="What is the part for? Include dimensions, preferred format, and timeline." /><button className="services-primary" disabled={!mailto} type="submit">Prepare email inquiry <ArrowUpRight size={16} /></button>{!mailto && <p className="services-note" role="status">{failed ? 'Could not load contact info. Reload page to retry.' : config ? 'Inquiries are not yet open. You can continue using the free editor.' : 'Loading contact info…'}</p>}</form></section>
      <section className="services-faq"><h2>FAQ</h2><details><summary>Do I have to pay to use the editor?</summary><p>No. The editor is completely free to use. Modeling inquiries and contributions are optional.</p></details><details><summary>Does submitting an inquiry commit me to pay?</summary><p>No. Inquiries are non-binding valuations. Pricing and scope are agreed upon beforehand.</p></details><details><summary>Does a donation unlock PRO features?</summary><p>No. Contributions support open-source maintenance and do not constitute a paid license.</p></details></section>
    </main><footer className="services-footer"><span>VOXEL3D CAD · From sketch to solid.</span><a href="/">Back to editor ↗</a></footer>
  </div>;
}
