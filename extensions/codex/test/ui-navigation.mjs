// Detailed-analysis tests enter through the same explicit action as a user.
export async function openAnalysis(page, url) {
    await page.goto(url);
    await page.frameLocator('iframe').locator('.open-analysis').click();
    await page.frameLocator('iframe').locator('.analysis-content').waitFor();
}
