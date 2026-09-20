'use strict';

// Telling the other screens that something changed.
//
// One person is signed in on a laptop and a phone. They close an organisation
// on the laptop; the phone is still showing it. Until now the phone found out
// when somebody reloaded it, which on a screen about who may do what is not a
// cosmetic problem: it is a stale list of people with access.
//
// What goes over the wire is a notice, never the thing that changed:
//
//     { topic: 'orgs' }            the list of organisations is not what it was
//     { topic: 'org', id: '4' }    something inside organisation 4 moved
//     { topic: 'me' }              the account itself changed
//
// The receiving screen asks for what it needs through the same endpoint it
// always used, with the same permission checks. That means a notice can never
// hand somebody data they could not already fetch, and an organisation's events
// can be addressed to its members without the payload having to be filtered per
// reader. It also keeps this file out of the business of shaping anything.
//
// Sent over server-sent events rather than a socket. The traffic is one way, so
// a socket would buy a channel back that nothing would use, while costing a
// dependency, an upgrade handshake and a second thing for the proxy in front of
// us to understand. EventSource also reconnects by itself, which is most of
// what a live connection has to get right.
//
// The register is in memory, which is correct for one instance and wrong for
// two: a notice published on one would never reach a reader attached to the
// other. When that day comes the fix is to publish through postgres LISTEN and
// NOTIFY and have every instance forward what it hears into this same register.

const HEARTBEAT_MS = 25000;
// A person with a laptop, a phone and a few tabs is ordinary. Far past that and
// something is looping, so the oldest goes rather than the newest being refused:
// a fresh connection is the one more likely to be a real screen.
const PER_USER = 12;

// userId -> Set of open responses
const readers = new Map();

function add(userId, res) {
    const key = String(userId);
    let mine = readers.get(key);
    if (!mine) {
        mine = new Set();
        readers.set(key, mine);
    }
    mine.add(res);
    while (mine.size > PER_USER) {
        const oldest = mine.values().next().value;
        mine.delete(oldest);
        try { oldest.end(); } catch (err) {  }
    }
    return () => {
        mine.delete(res);
        if (!mine.size) readers.delete(key);
    };
}

function write(res, event) {
    try {
        res.write('data: ' + JSON.stringify(event) + '\n\n');
        return true;
    } catch (err) {
        return false;
    }
}

// Attach one reader. Returns the function that detaches it, which the caller
// hangs off the request closing.
function open(res, userId) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, private, no-transform',
        Connection: 'keep-alive',
        // a proxy that buffers a stream turns it into a very slow poll
        'X-Accel-Buffering': 'no',
    });
    // tells EventSource how long to wait before trying again, and gets the
    // first bytes out so nothing in between holds the response open empty
    res.write('retry: 4000\n\n');

    const drop = add(userId, res);
    const beat = setInterval(() => {
        // a comment line: it keeps the connection from being reaped by anything
        // in the middle without waking the page up
        try { res.write(': ping\n\n'); } catch (err) {  }
    }, HEARTBEAT_MS);

    return () => {
        clearInterval(beat);
        drop();
    };
}

// Tell these people that something moved. Ids are whatever the caller has:
// numbers, strings, duplicates and nulls are all fine.
function publish(userIds, event) {
    const seen = new Set();
    (userIds || []).forEach((id) => {
        if (id === null || id === undefined) return;
        const key = String(id);
        if (seen.has(key)) return;
        seen.add(key);
        const mine = readers.get(key);
        if (!mine) return;
        [...mine].forEach((res) => {
            if (!write(res, event)) mine.delete(res);
        });
    });
}

function status() {
    let open_ = 0;
    readers.forEach((set) => { open_ += set.size; });
    return { people: readers.size, connections: open_ };
}

module.exports = { open, publish, status, HEARTBEAT_MS, PER_USER };
