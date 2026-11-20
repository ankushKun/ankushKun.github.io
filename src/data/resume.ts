// Resume data. Single source of truth for Resume, About and structured data.
// Dates are "YYYY-MM". Leave `end` out for a current role. Highlights support **bold** and [links](url).

export interface ExperienceItem {
  role: string;
  org: string;
  url: string;
  location?: string;
  start: string;
  end?: string;
  highlights: string[];
}

export interface ResumeProject {
  name: string;
  url: string;
  more?: string;
  tech: string[];
  start: string;
  highlights: string[];
}

export interface EducationItem {
  degree: string;
  field: string;
  school: string;
  start?: string;
  end?: string;
}

export interface SkillGroup {
  label: string;
  items: string[];
}

export const resume: {
  pdf: string;
  pdfDownloadName: string;
  summary: string;
  experience: ExperienceItem[];
  projects: ResumeProject[];
  education: EducationItem[];
  skills: SkillGroup[];
} = {
  pdf: '/resume.pdf',
  pdfDownloadName: 'Ankush-Singh-Resume.pdf',
  summary:
    'Co-founder of Construct Computer, a workforce of AI employees with their own cloud computers, launched as **#1 Product of the Day on Product Hunt**. Full-stack engineer building AI agents, MCP servers, Cloudflare backends, Solana programs, and firmware. Previously built BetterIDEa, **acquired by Forward Research**.',
  experience: [
    {
      role: 'Co-founder',
      org: 'Construct Computer',
      url: 'https://construct.computer/?utm_source=ankush.one&utm_medium=referral&utm_campaign=resume',
      start: '2026-02',
      highlights: [
        '**Built the agent platform**: a runtime on Cloudflare Workers and Durable Objects, a React desktop to watch agents work live, MCP apps, long-term memory, and sandboxed tools.',
        'Migrated from a container-per-user VPS to Workers, Durable Objects, Containers, R2, and D1 in **~10 days**.',
        'Shipped the Jev decision model into agent memory **5 days after release** (1 call instead of up to 3 LLM-judge calls) and **first-authored** a [1,053-call model-swap study](/blogs/clef-vs-jev-benchmark/).',
        'Open-sourced [CWAB](https://github.com/construct-computer/cloud-workspace-agent-benchmark), an agent benchmark vs OpenClaw and Hermes, and [Foxwatch](https://github.com/hypervoid-inc/foxwatch), our status monitor.',
      ],
    },
    {
      role: 'Entrepreneur in Residence',
      org: 'Forward Research',
      url: 'https://fwd.arweave.net/',
      start: '2024-11',
      end: '2025-10',
      highlights: [
        'Rewrote BetterIDEa for HyperBEAM and made the AO Package Manager **load by default in every aos process**.',
        'Built WAuth, a social-login SDK with invisible wallets (**~5,300 npm downloads**), later **adopted by ArLink Labs**.',
      ],
    },
    {
      role: 'Developer Relations Engineer',
      org: 'Arweave India',
      url: 'https://arweaveindia.com',
      start: '2024-06',
      end: '2025-04',
      highlights: [
        'Organised Arweave Day India 2025 and hackerhouses; **mentored 100+ developers** and judged 40+ builds.',
      ],
    },
    {
      role: 'Founder',
      org: 'BetterIDEa',
      url: 'https://betteridea.arweave.net',
      start: '2023-12',
      end: '2024-10',
      highlights: [
        'Built a web IDE and package manager for AO, launched with its testnet and **acquired by Forward Research**.',
      ],
    },
    {
      role: 'Software Engineer Intern',
      org: 'Physics Wallah',
      url: 'https://www.pw.live',
      start: '2022-11',
      end: '2023-05',
      highlights: [
        'Built a live-class tool parsing real-time YouTube chat (10K+ messages) for **50K+ concurrent viewers**.',
      ],
    },
  ],
  projects: [
    {
      name: 'NepoNet',
      url: 'https://nepotism.network',
      more: '/projects/neponet/',
      tech: ['TypeScript', 'Hono', 'Cloudflare Workers', 'React', 'MCP'],
      start: '2026-09',
      highlights: [
        'Warm-intro finder for X that scores follow-graph routes and drafts the first message, with a remote MCP server (OAuth) so coding agents can use it; **#9 Product of the Day** on Product Hunt.',
      ],
    },
    {
      name: 'create-magicblock',
      url: 'https://github.com/ankushKun/create-magicblock',
      more: '/projects/create-magicblock/',
      tech: ['TypeScript', 'Solana', 'Anchor', 'MagicBlock'],
      start: '2025-12',
      highlights: [
        'CLI that scaffolds a working MagicBlock app (Solana ephemeral rollups) in seconds; **1,300+ npm downloads**.',
      ],
    },
    {
      name: 'Quadcopter Flight Controller',
      url: 'https://github.com/ankushKun/vega-fc-sketch',
      more: '/projects/vega-flight-controller/',
      tech: ['C++', 'RISC-V', 'Embedded'],
      start: '2023-06',
      highlights: [
        'Drone firmware for the RISC-V VEGA board with IMU calibration and PID control; **won C-DAC Vegathon**.',
      ],
    },
  ],
  education: [
    {
      degree: 'Bachelor of Engineering',
      field: 'Computer Science',
      school: 'Chandigarh University',
    },
  ],
  skills: [
    { label: 'Languages', items: ['TypeScript', 'JavaScript', 'Rust', 'Python', 'C++', 'Lua', 'SQL'] },
    {
      label: 'AI & Agents',
      items: ['AI agents', 'Model Context Protocol (MCP)', 'Tool calling', 'Agent memory', 'Evals', 'Structured outputs'],
    },
    {
      label: 'Backend & Cloud',
      items: ['Node.js', 'Hono', 'WebSockets', 'Cloudflare Workers', 'Durable Objects', 'D1', 'R2', 'Docker', 'AWS'],
    },
    {
      label: 'Hardware',
      items: ['ESP32 (ESP-IDF)', 'Raspberry Pi', 'Arduino', 'RISC-V', 'PlatformIO', 'IMU sensors', 'PID control'],
    },
    {
      label: 'Frontend & Web3',
      items: ['React', 'Next.js', 'Tailwind CSS', 'Electron', 'Solana', 'Anchor', 'Arweave', 'AO'],
    },
  ],
};

export type Experience = ExperienceItem;
