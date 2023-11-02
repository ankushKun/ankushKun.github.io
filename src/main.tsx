import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'

import Home from './App.tsx'
import Certificates from './pages/certificates.tsx'
import Charges from './pages/charges.tsx'
import Links from './pages/links.tsx'
import Projects from './pages/projects.tsx'
import Resume from './pages/resume.tsx'
import Timeline from './pages/timeline.tsx'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/certificates" element={<Certificates />} />
        <Route path="/charges" element={<Charges />} />
        <Route path="/links" element={<Links />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/resume" element={<Resume />} />
        <Route path="/timeline" element={<Timeline />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)
