'use strict';

// Month arithmetic, in one place.
//
// Two things need it and they must agree to the second: billing, which decides
// what a period is, and usage, which counts what happened inside one. Two
// copies of this would be two answers to "which month is this", and the day
// they disagree is the day a screening is counted in a period it was not in.
//
// Everything here is UTC. A billing period that moves with a reader's clock is
// a period whose boundary depends on who is looking at it.

function atUTC(y, m, d) {
    return new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
}

// The 31st of a month does not exist in the next one. Clamping down keeps every
// period a whole month and keeps them touching, with no day belonging to two
// periods or to none.
function addMonths(date, n) {
    const d = new Date(date);
    const day = d.getUTCDate();
    const target = atUTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1);
    const last = atUTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0).getUTCDate();
    const out = atUTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, last));
    // a period anchored at a time of day keeps it, so a subscription bought at
    // 14:05 does not quietly move to midnight on its second month
    out.setUTCHours(d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
    return out;
}

// The month-long window, anchored on `anchor`, that `now` falls inside.
function periodAround(anchor, now) {
    const at = new Date(anchor);
    const when = new Date(now || Date.now());
    if (when.getTime() < at.getTime()) {
        return { from: at, to: addMonths(at, 1) };
    }
    // walk forward in months rather than guessing, so clamping never puts the
    // boundary on the wrong side of today
    let from = at;
    let guard = 0;
    while (guard++ < 2400) {
        const to = addMonths(from, 1);
        if (when.getTime() < to.getTime()) return { from, to };
        from = to;
    }
    return { from, to: addMonths(from, 1) };
}

module.exports = { atUTC, addMonths, periodAround };
