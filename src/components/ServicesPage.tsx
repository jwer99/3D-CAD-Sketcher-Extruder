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
  const [service, setService] = useState('Modelado de una pieza');
  const [brief, setBrief] = useState('');
  useEffect(() => {
    document.title = 'Servicios CAD y apoyo al proyecto | VOXEL3D';
    const controller = new AbortController();
    fetch('/api/commerce', { signal: controller.signal }).then(r => {
      if (!r.ok) throw new Error('Configuración no disponible');
      return r.json();
    }).then(setConfig).catch(e => { if (e.name !== 'AbortError') setFailed(true); });
    return () => controller.abort();
  }, []);
  const mailto = config?.salesEmail ? `mailto:${encodeURIComponent(config.salesEmail)}?subject=${encodeURIComponent(`Presupuesto CAD — ${service}`)}&body=${encodeURIComponent(`Servicio: ${service}\n\n${brief}\n\nFormato de entrega deseado:\nPlazo deseado:\nPresupuesto aproximado:\n`)}` : null;
  return <div className="services-page">
    <nav className="services-nav" aria-label="Navegación principal"><a className="services-brand" href="/"><span className="services-logo">V</span> VOXEL3D <span>CAD</span></a><span className="services-nav-label">SERVICIOS Y APOYO</span><div className="services-nav-actions"><button className="services-outline services-theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Alternar Tema">{theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}</button><a href="/" className="services-primary">Abrir editor <ArrowUpRight size={14} /></a></div></nav>
    <main>
      <section className="services-hero">
        <div><p className="services-eyebrow">DEL BOCETO A LA PIEZA</p><h1>Tu próxima idea.<br /><em>En tres dimensiones.</em></h1><p className="services-intro">Diseña en el navegador con VOXEL3D. ¿Necesitas ayuda para avanzar? Consulta la posibilidad de encargar el modelado de tu pieza.</p><div className="services-actions"><a className="services-primary" href="/">Diseñar gratis <ArrowUpRight size={18} /></a><a className="services-outline" href="#presupuesto">Consultar un proyecto</a></div><p className="services-note">Bocetos 2D · Extrusión y revolución · STEP, STL y OBJ</p></div>
        <div className="services-art" aria-hidden="true"><div className="services-orbit" /><div className="services-cube"><Box size={150} strokeWidth={0.65} /></div><span className="services-art-label">IDEA → BOCETO → VOLUMEN</span><span className="services-dimension">X / Y / Z &nbsp; · &nbsp; mm</span></div>
      </section>
      <section className="services-options" aria-labelledby="options-title"><p className="services-eyebrow">ELIGE CÓMO AVANZAR</p><h2 id="options-title">Una herramienta. Tres formas de participar.</h2><div className="services-grid">
        <article className="services-card"><Box /><h3>Hazlo tú</h3><p>Explora tus ideas con el editor CAD en el navegador.</p><strong>Gratis</strong><ul><li><Check /> Bocetos y operaciones de modelado</li><li><Check /> Importación STEP, STL y OBJ</li><li><Check /> Exportación de geometría</li></ul><a className="services-outline" href="/">Abrir el editor <ArrowUpRight size={16} /></a></article>
        <article className="services-card services-featured"><MoveUpRight /><h3>Ayuda con tu pieza</h3><p>Cuéntanos qué necesitas modelar, adaptar o convertir.</p><strong>Presupuesto a medida</strong><ul><li><Check /> Describe la pieza y sus medidas</li><li><Check /> Indica formato y plazo deseados</li><li><Check /> Acuerda alcance y precio antes de pagar</li></ul><a className="services-primary" href="#presupuesto">Consultar disponibilidad <ArrowUpRight size={16} /></a></article>
        <article className="services-card"><Heart /><h3>Apoya VOXEL3D</h3><p>Contribuye al mantenimiento y al desarrollo del proyecto.</p><strong>Aportación voluntaria</strong><ul><li><Check /> Sin funciones bloqueadas</li><li><Check /> Importe y condiciones en la página de pago</li><li><Check /> No incluye servicios de modelado</li></ul>{config?.supportUrl ? <a className="services-outline" href={config.supportUrl} target="_blank" rel="noopener noreferrer">Apoyar el proyecto <ArrowUpRight size={16} /></a> : <p className="services-note" role="status">{failed ? 'No se pudo cargar el enlace de apoyo. Recarga la página.' : config ? 'Las aportaciones todavía no están habilitadas.' : 'Cargando opciones de apoyo…'}</p>}</article>
      </div></section>
      <section id="presupuesto" className="services-contact"><div><p className="services-eyebrow">EMPECEMOS POR TU IDEA</p><h2>¿Qué necesitas crear?</h2><p>Prepara tu consulta y envíala desde tu correo. La disponibilidad, el alcance, el precio y la entrega se acuerdan antes de iniciar cualquier trabajo.</p><p className="services-note">Este formulario no guarda tu texto en el servidor. Al continuar se abrirá tu aplicación de correo; tendrás que enviar el mensaje para completar la consulta.</p></div><form onSubmit={e => { e.preventDefault(); if (mailto) window.location.href = mailto; }}><label htmlFor="service">Tipo de proyecto</label><select id="service" value={service} onChange={e => setService(e.target.value)}><option>Modelado de una pieza</option><option>Adaptación de un modelo existente</option><option>Conversión de archivos CAD</option><option>Otra consulta</option></select><label htmlFor="brief">Describe tu pieza</label><textarea id="brief" required minLength={20} maxLength={1500} rows={5} value={brief} onChange={e => setBrief(e.target.value)} placeholder="¿Qué debe hacer la pieza? Incluye medidas, formato y plazo deseados." /><button className="services-primary" disabled={!mailto} type="submit">Preparar consulta por email <ArrowUpRight size={16} /></button>{!mailto && <p className="services-note" role="status">{failed ? 'No se pudo cargar el contacto. Recarga la página para volver a intentarlo.' : config ? 'Las consultas todavía no están habilitadas. Puedes seguir usando el editor gratuito.' : 'Cargando contacto…'}</p>}</form></section>
      <section className="services-faq"><h2>Antes de empezar</h2><details><summary>¿Tengo que pagar para usar el editor?</summary><p>No. El editor sigue disponible gratis. Las consultas de modelado y las aportaciones son opcionales.</p></details><details><summary>¿Enviar una consulta me compromete a pagar?</summary><p>No. La consulta sirve para valorar el trabajo. El precio y las condiciones se acuerdan por separado.</p></details><details><summary>¿Una aportación desbloquea funciones PRO?</summary><p>No. Una aportación apoya al proyecto y no compra una licencia ni un servicio.</p></details></section>
    </main><footer className="services-footer"><span>VOXEL3D CAD · Del boceto al volumen.</span><a href="/">Volver al editor ↗</a></footer>
  </div>;
}
