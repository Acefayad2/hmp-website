import {defineConfig} from "@playwright/test";
export default defineConfig({
  testDir:"./tests/browser",
  testMatch:["money-bank-draft.spec.mjs","service-time-fields.spec.mjs"],
  projects:[
    {name:"desktop",use:{viewport:{width:1440,height:1000}}},
    {name:"mobile",use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}},
    {name:"tablet",use:{viewport:{width:820,height:1180},isMobile:true,hasTouch:true}},
  ],
  fullyParallel:false,
  workers:1,
  retries:0,
  timeout:30000,
  reporter:[["list"],["html",{outputFolder:"output/money-bank-browser-report",open:"never"}]],
  outputDir:"output/money-bank-browser-results",
  use:{baseURL:"http://127.0.0.1:8787",browserName:"chromium",trace:"retain-on-failure",screenshot:"only-on-failure"},
  webServer:{command:"python3 -m http.server 8787 --bind 127.0.0.1 --directory dist",url:"http://127.0.0.1:8787/agreement.html",reuseExistingServer:false},
});
