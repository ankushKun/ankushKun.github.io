#!/usr/bin/env node
/**
 * Software Update changelog. No dependencies.
 *
 *   node scripts/changelog.mjs           Rewrite data/changelog.json from `git log`
 *   node scripts/changelog.mjs --check   Print what would be written, change nothing
 *   node scripts/changelog.mjs --force   Write even when history looks truncated
 *
 * The deploy workflow runs this before the Hugo build, so the live site always
 * lists the commit being deployed. The file is also committed as a snapshot:
 * local builds, and clones without full history, render the last snapshot.
 *
 * One update is one day of commits. Titles, icons and wording come from
 * scripts/changelog.curation.json - see the notes at the top of that file.
 *
 * This script can never fail a build: on any problem it leaves the existing
 * snapshot alone and exits 0.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'changelog.json');
const CURATION = path.join(ROOT, 'scripts', 'changelog.curation.json');

const MAX_NOTES = 12;       // generated notes per update
const MAX_NOTE_LENGTH = 160;
const MAX_TITLE_LENGTH = 72;

const args = new Set(process.argv.slice(2));
const CHECK = args.has('--check');
const FORCE = args.has('--force');

function git(...argv) {
    return execFileSync('git', argv, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function readJson(file) {
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
        return null;
    }
}

function keep(reason) {
    console.log(`changelog: ${reason}; keeping the existing data/changelog.json`);
    process.exit(0);
}

function compile(patterns) {
    const out = [];
    for (const source of patterns || []) {
        try {
            out.push(new RegExp(source, 'i'));
        } catch (e) {
            console.warn(`changelog: skipping invalid pattern ${JSON.stringify(source)}`);
        }
    }
    return out;
}

/** "fix: home." -> "Fix: home"; long subjects are cut at a word boundary. */
function tidy(subject, max) {
    let text = String(subject).replace(/\s+/g, ' ').trim().replace(/[.;,]+$/, '');
    if (text.length > max) text = text.slice(0, max).replace(/\s+\S*$/, '') + '…';
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function joinLabels(labels) {
    if (labels.length <= 1) return labels[0] || '';
    return labels.slice(0, -1).join(', ') + ' and ' + labels[labels.length - 1];
}

function main() {
    const curation = readJson(CURATION);
    if (!curation) keep('scripts/changelog.curation.json is missing or not valid JSON');

    const previous = readJson(OUT);

    let raw;
    try {
        // Unit separator between fields, record separator between commits
        raw = git('log', '--no-merges', '--format=%H%x1f%cI%x1f%s%x1e');
    } catch (e) {
        keep('git log failed (not a git checkout?)');
    }

    const commits = raw.split('\x1e').map((record) => {
        const [hash, date, subject] = record.trim().split('\x1f');
        return { hash, date, subject: (subject || '').trim() };
    }).filter((c) => /^[0-9a-f]{40}$/.test(c.hash || '') && !Number.isNaN(Date.parse(c.date)));

    if (!commits.length) keep('no commits found');

    // A shallow clone sees only the newest commits. Replacing the snapshot
    // with that would throw away the history it already holds.
    if (!FORCE && previous && Number.isInteger(previous.commits) && commits.length < previous.commits) {
        keep(`history has ${commits.length} commits but the snapshot was built from ${previous.commits} (shallow clone?)`);
    }

    const ignore = compile(curation.ignore);
    const areas = (curation.areas || []).map((area) => {
        const [pattern] = compile([area.match]);
        return pattern ? { pattern, label: String(area.label || ''), app: area.app || '' } : null;
    }).filter(Boolean);
    const releases = curation.releases || {};
    const areaOf = (subject) => areas.find((area) => area.pattern.test(subject)) || null;

    // Newest first, so the first commit seen for a day is that day's latest.
    // The day is the one on the committer's own calendar (their UTC offset).
    const days = new Map();
    commits.forEach((commit, index) => {
        const day = commit.date.slice(0, 10);
        if (!days.has(day)) {
            days.set(day, {
                date: day,
                ts: Math.floor(Date.parse(commit.date) / 1000),
                // The n-th commit in the history, counted from the first
                build: commits.length - index,
                commits: []
            });
        }
        days.get(day).commits.push(commit);
    });

    const updates = [];
    for (const day of days.values()) {
        const curated = releases[day.date] || {};
        if (curated.hide) continue;

        // Generated notes: one per distinct subject worth showing
        const seen = new Set();
        const generated = [];
        for (const commit of day.commits) {
            if (!commit.subject || ignore.some((pattern) => pattern.test(commit.subject))) continue;
            const key = commit.subject.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            generated.push({ text: tidy(commit.subject, MAX_NOTE_LENGTH), area: areaOf(commit.subject) });
        }

        const curatedNotes = Array.isArray(curated.notes)
            ? curated.notes.map((note) => String(note).trim()).filter(Boolean)
            : [];
        const notes = curatedNotes.length ? curatedNotes : generated.slice(0, MAX_NOTES).map((note) => note.text);
        if (!notes.length) continue;

        // Areas in the order they first appear, most commits first
        const tally = new Map();
        for (const note of generated) {
            if (!note.area) continue;
            tally.set(note.area, (tally.get(note.area) || 0) + 1);
        }
        const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([area]) => area);

        let title = typeof curated.title === 'string' ? curated.title.trim() : '';
        if (!title) {
            const labels = ranked.map((area) => area.label).filter(Boolean).slice(0, 3);
            if (notes.length === 1 || !labels.length) title = tidy(notes[0], MAX_TITLE_LENGTH);
            else title = joinLabels(labels);
        }

        const app = typeof curated.app === 'string' ? curated.app : ((ranked.find((area) => area.app) || {}).app || '');

        const update = { date: day.date, ts: day.ts, build: day.build, title };
        if (app) update.app = app;
        update.notes = notes;
        // Verbatim, newest first: [short hash, subject]
        update.log = day.commits.map((commit) => [commit.hash.slice(0, 7), commit.subject.slice(0, 200)]);
        updates.push(update);
    }

    if (!updates.length) keep('no update survived curation');

    const output = {
        repo: String(curation.repo || '').replace(/\/+$/, ''),
        head: commits[0].hash.slice(0, 7),
        commits: commits.length,
        updates
    };
    const json = JSON.stringify(output, null, 1) + '\n';

    if (CHECK) {
        for (const update of updates) {
            console.log(`${update.date}  build ${String(update.build).padStart(4)}  ${update.title}${update.app ? `  [${update.app}]` : ''}`);
            for (const note of update.notes) console.log(`              - ${note}`);
        }
        console.log(`changelog: ${updates.length} updates from ${commits.length} commits (nothing written)`);
        return;
    }

    let current = '';
    try { current = readFileSync(OUT, 'utf8'); } catch (e) { /* first run */ }
    if (current === json) {
        console.log(`changelog: data/changelog.json is up to date (${updates.length} updates, ${commits.length} commits)`);
        return;
    }
    writeFileSync(OUT, json);
    console.log(`changelog: wrote ${updates.length} updates from ${commits.length} commits to data/changelog.json`);
}

try {
    main();
} catch (e) {
    console.warn(`changelog: ${e && e.message ? e.message : e}; keeping the existing data/changelog.json`);
}
