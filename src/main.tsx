import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'

import Home from './App.tsx'
import Certificates from './pages/certificates.tsx'
import Charges from './pages/charges.tsx'
import Blog from './pages/blog.tsx'
import Links from './pages/links.tsx'
import Projects from './pages/projects.tsx'
import Resume from './pages/resume.tsx'
import Timeline from './pages/timeline.tsx'
import E404 from './pages/404.tsx'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/certificates" element={<Certificates />} />
        <Route path="/charges" element={<Charges />} />
        <Route path="/links" element={<Links />} />
        <Route path="/blog" element={<Blog />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/resume" element={<Resume />} />
        <Route path="/timeline" element={<Timeline />} />
        <Route path="*" element={<E404 />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)
