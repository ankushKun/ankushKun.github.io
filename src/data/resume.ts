// Resume data. The single source for experience shown on Resume, About and the home page.
// Dates are "YYYY-MM". Leave `end` out for a current role. Highlights support **bold** and [links](url).

export const resume = {
  pdf: '/resume.pdf',
  summary: 'Placeholder summary. Two or three sentences on what you do, what you have shipped and what you want next.',
  experience: [
    {
      role: 'Placeholder Role',
      org: 'Placeholder Company',
      url: 'https://example.com',
      location: 'Remote',
      start: '2026-01',
      highlights: ['Placeholder highlight with a **measurable result**.', 'Placeholder highlight with a [link](https://example.com).'],
    },
    {
      role: 'Placeholder Previous Role',
      org: 'Placeholder Previous Company',
      url: 'https://example.com',
      location: 'Placeholder City',
      start: '2024-06',
      end: '2025-12',
      highlights: ['Placeholder highlight.', 'Placeholder highlight.'],
    },
  ],
  education: [{ degree: 'Bachelor of Engineering', field: 'Computer Science', school: 'Placeholder University', start: '2022-08', end: '2026-06' }],
  skills: [
    { label: 'Languages', items: ['Placeholder', 'Placeholder'] },
    { label: 'Tools', items: ['Placeholder', 'Placeholder'] },
  ],
};

export type Experience = (typeof resume.experience)[number];
