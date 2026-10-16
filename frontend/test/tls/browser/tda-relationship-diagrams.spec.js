import { test, expect } from './fixtures.js';

async function expectClearLayout(graph) {
    await expect.poll(() => graph.evaluate(el => {
        const cards = [...el.querySelectorAll('[data-rel-node]')].map(n => n.getBoundingClientRect());
        const labels = [...el.querySelectorAll('.relationship-edge text')].map(n => n.getBoundingClientRect());
        const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        const bounds = el.getBoundingClientRect();
        return cards.some((a, i) => cards.some((b, j) => i !== j && overlap(a, b)))
            || labels.some(a => cards.some(b => overlap(a, b)))
            || [...cards, ...labels].some(a => a.left < bounds.left || a.right > bounds.right);
    })).toBe(false);
}

test('TDA inline graphs retain two/three-thread cycles and expand every class-init waiter', async ({ page, appUrl }) => {
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    await page.locator('#loadSampleBtn').click();
    await page.locator('.deadlock-panel-summary').click();
    const cycles = page.locator('#deadlockPanel .relationship-figure');
    await expect(cycles).toHaveCount(2);
    await expect(cycles.nth(0).locator('.relationship-edge')).toHaveCount(4);
    await expect(cycles.nth(1).locator('.relationship-edge')).toHaveCount(6);
    for (const width of [1440, 600, 420]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const graph of await cycles.all()) await expectClearLayout(graph);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.locator('.class-initialization-panel-summary').click();
    const graph = page.locator('#classInitializationPanel .relationship-figure').first();
    const waiters = graph.locator('[data-rel-node="0"]');
    const expected = Number((await waiters.locator('.relationship-node-count').textContent()).match(/\d+/)[0]);
    await expect(waiters.locator('.relationship-thread-btn:visible')).toHaveCount(3);
    await waiters.locator('.relationship-more summary').click();
    await expect(waiters.locator('.relationship-thread-btn:visible')).toHaveCount(expected);
    await expectClearLayout(graph);
    const thread = waiters.locator('.relationship-thread-btn').last();
    await thread.click();
    await expect(page.locator('#threadModal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(thread).toBeFocused();
    await page.locator('#clearBtn').click();
    await expect(page.locator('[data-relationship-diagram]')).toHaveCount(0);
});

function largeCycle(count) {
    const name = i => `worker-${i}-with-a-long-descriptive-name-for-layout-verification`;
    const lock = i => `0x${(4096 + i).toString(16)}`;
    const threads = Array.from({ length: count }, (_, i) => `"${name(i)}" #${i + 1} prio=5 tid=0x${i + 1} nid=0x${i + 1} waiting for monitor entry
 java.lang.Thread.State: BLOCKED (on object monitor)
 at example.Worker.run(Worker.java:12)
 - waiting to lock <${lock(i)}> (a example.VeryLongLockTypeForReadableGraphs)
 - locked <${lock((i + count - 1) % count)}> (a example.VeryLongLockTypeForReadableGraphs)
`).join('\n');
    const report = Array.from({ length: count }, (_, index) => {
        const i = (index * 2) % count; // Deliberately not dependency order.
        return `"${name(i)}":
 waiting to lock monitor 0x${i + 1} (object ${lock(i)}, a example.VeryLongLockTypeForReadableGraphs),
 which is held by "${name((i + 1) % count)}"`;
    }).join('\n\n');
    return `Full thread dump OpenJDK 64-Bit Server VM:\n\n${threads}\nFound one Java-level deadlock:\n=============================\n${report}\n\nJava stack information for the threads listed above:\n`;
}

test('TDA five-thread cycle with long labels retains every dependency without overlaps', async ({ page, appUrl }) => {
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    await page.locator('#fileInput').setInputFiles({ name: 'five-thread-cycle.txt', mimeType: 'text/plain', buffer: Buffer.from(largeCycle(5)) });
    await page.locator('.deadlock-panel-summary').click();
    const graph = page.locator('#deadlockPanel .relationship-figure');
    await expect(graph).toHaveCount(1);
    await expect(graph.locator('.relationship-node')).toHaveCount(10);
    await expect(graph.locator('.relationship-edge')).toHaveCount(10);
    await expect(graph.locator('.relationship-edge.is-closing')).toHaveCount(1);
    for (const width of [1440, 600, 420]) {
        await page.setViewportSize({ width, height: 900 });
        await expectClearLayout(graph);
    }
});
