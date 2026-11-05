// Local vector drawings; no icon font, external assets or HTML parsing.
const paths = {
    moon: ['M17.5 3.8A8.7 8.7 0 1 0 20.2 17 7.2 7.2 0 0 1 17.5 3.8Z', 'M6 7h3M7.5 5.5v3M18 8h4M20 6v4'],
    sun: ['M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z', 'M12 1v3m0 16v3M1 12h3m16 0h3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1'],
    cards: ['M8 3h11v17H8Z', 'M5 6H2l3 16 3-.6', 'm13.5 7 1.2 3.3L18 11.5l-3.3 1.2-1.2 3.3-1.2-3.3L9 11.5l3.3-1.2Z'],
    back: ['M20 12H4m6-6-6 6 6 6'],
    close: ['m6 6 12 12M18 6 6 18'],
    settings: ['M4 6h16M4 12h16M4 18h16', 'M8 3v6m8 0v6M10 15v6'],
    check: ['M20 11a8 8 0 1 1-5-6.4', 'm9 10 3 3 9-10'],
    hand: ['M9 12V5a2 2 0 0 1 4 0v6-2a2 2 0 0 1 3 0v2a2 2 0 0 1 3 0v4c0 4-2 6-6 6-3 0-4-2-6-4l-3-4a2 2 0 0 1 3-2l2 2'],
};
export function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', 'stroke-width':'1.4', 'stroke-linecap':'round', 'stroke-linejoin':'round', 'aria-hidden':'true', focusable:'false', class:'tf-icon' })) svg.setAttribute(key, value);
    for (const d of paths[name] || paths.moon) {
        const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); svg.append(path);
    }
    return svg;
}
