const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto("http://localhost:3000/operator");
    const content = await page.content();
    console.log("--- PAGE CONTENT START ---");
    console.log(content);
    console.log("--- PAGE CONTENT END ---");
  } catch (err) {
    console.error(err);
  } finally {
    await browser.close();
  }
})();
