const { classifyRepo, isAlertPriority, extractMRLinks, isReadyForProd, calculatePriorityWeight } = require("./classify");

console.log("🧪 Testing Deploy Tracker Classifier\n");

// Test classifyRepo
const repoTests = [
  { repo: "wssiniestralidad", expected: "core_backend" },
  { repo: "wslogistica", expected: "core_backend" },
  { repo: "wsauditoriafacturacion", expected: "core_backend" },
  { repo: "portal-art", expected: "core_frontend" },
  { repo: "portal-prestador", expected: "core_frontend" },
  { repo: "ws-reportes", expected: "secondary_backend" },
  { repo: "wsnotificaciones", expected: "secondary_backend" },
  { repo: "landing-page", expected: "secondary_frontend" },
  { repo: "admin-panel", expected: "secondary_frontend" },
];

console.log("━━ classifyRepo ━━");
let passed = 0;
for (const test of repoTests) {
  const result = classifyRepo(test.repo);
  const ok = result.type === test.expected;
  console.log(`  ${ok ? "✅" : "❌"} ${test.repo} → ${result.type} (expected: ${test.expected})`);
  if (ok) passed++;
}
console.log(`  ${passed}/${repoTests.length} passed\n`);

// Test isAlertPriority
console.log("━━ isAlertPriority ━━");
const priorityTests = [
  { priority: "Blocker", expected: true },
  { priority: "High", expected: true },
  { priority: "blocker", expected: true },
  { priority: "Medium", expected: false },
  { priority: "Low", expected: false },
  { priority: "", expected: false },
  { priority: null, expected: false },
];

passed = 0;
for (const test of priorityTests) {
  const result = isAlertPriority(test.priority);
  const ok = result === test.expected;
  console.log(`  ${ok ? "✅" : "❌"} "${test.priority}" → ${result} (expected: ${test.expected})`);
  if (ok) passed++;
}
console.log(`  ${passed}/${priorityTests.length} passed\n`);

// Test extractMRLinks
console.log("━━ extractMRLinks ━━");
const baseUrl = "https://gitlab.grv.com.ar";
const mrTests = [
  {
    text: "Revisar la MR https://gitlab.grv.com.ar/grv/backend/wssiniestralidad/-/merge_requests/892",
    expectedCount: 1,
  },
  {
    text: `Hay dos MRs: 
      https://gitlab.grv.com.ar/grv/backend/wslogistica/-/merge_requests/445
      https://gitlab.grv.com.ar/grv/frontend/portal-art/-/merge_requests/123`,
    expectedCount: 2,
  },
  {
    text: "Sin links aquí",
    expectedCount: 0,
  },
  {
    text: "[Ver MR|https://gitlab.grv.com.ar/grv/backend/wssiniestralidad/-/merge_requests/892]",
    expectedCount: 1,
  },
  {
    // Duplicate links
    text: `https://gitlab.grv.com.ar/grv/backend/ws-test/-/merge_requests/1
           https://gitlab.grv.com.ar/grv/backend/ws-test/-/merge_requests/1`,
    expectedCount: 1,
  },
];

passed = 0;
for (const test of mrTests) {
  const result = extractMRLinks(test.text, baseUrl);
  const ok = result.length === test.expectedCount;
  console.log(`  ${ok ? "✅" : "❌"} Found ${result.length} MR(s) (expected: ${test.expectedCount})`);
  if (result.length > 0) {
    result.forEach((r) => console.log(`      → ${r.projectPath} MR !${r.mrIid}`));
  }
  if (ok) passed++;
}
console.log(`  ${passed}/${mrTests.length} passed\n`);

// Test isReadyForProd
console.log("━━ isReadyForProd ━━");
const statusTests = [
  { status: "Ready for Prod", expected: true },
  { status: "Listo para prod", expected: true },
  { status: "QA Aprobado", expected: true },
  { status: "Done", expected: true },
  { status: "In Progress", expected: false },
  { status: "Code Review", expected: false },
  { status: "", expected: false },
];

passed = 0;
for (const test of statusTests) {
  const result = isReadyForProd(test.status);
  const ok = result === test.expected;
  console.log(`  ${ok ? "✅" : "❌"} "${test.status}" → ${result} (expected: ${test.expected})`);
  if (ok) passed++;
}
console.log(`  ${passed}/${statusTests.length} passed\n`);

// Test calculatePriorityWeight
console.log("━━ calculatePriorityWeight ━━");
const w1 = calculatePriorityWeight({ isCore: true, jiraPriority: "Blocker", isReady: true });
const w2 = calculatePriorityWeight({ isCore: true, jiraPriority: "High", isReady: true });
const w3 = calculatePriorityWeight({ isCore: false, jiraPriority: "High", isReady: true });
const w4 = calculatePriorityWeight({ isCore: false, jiraPriority: "Low", isReady: false });
console.log(`  Core+Blocker+Ready: ${w1} (should be highest)`);
console.log(`  Core+High+Ready: ${w2}`);
console.log(`  Secondary+High+Ready: ${w3}`);
console.log(`  Secondary+Low+NotReady: ${w4} (should be lowest)`);
console.log(`  ${w1 > w2 && w2 > w3 && w3 > w4 ? "✅" : "❌"} Ordering is correct\n`);

console.log("🏁 All tests complete.");
