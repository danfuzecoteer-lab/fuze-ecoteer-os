#!/usr/bin/env node

const {
  listCloudAutomations,
  runCloudAutomationById,
  runCloudAutomationGroup,
} = require('../api/lib/cloud-automations');

function parseArgs(argv) {
  const args = { dryRun: false, group: null, onlyId: null, testTo: null };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (token === '--group') {
      args.group = argv[index + 1] || null;
      index += 1;
      continue;
    }
    if (token === '--only-id') {
      args.onlyId = argv[index + 1] || null;
      index += 1;
      continue;
    }
    if (token === '--test-to') {
      args.testTo = argv[index + 1] || null;
      index += 1;
      continue;
    }
    if (token === '--help' || token === '-h') {
      args.help = true;
      break;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function printUsage() {
  console.log('Usage: node scripts/run-cloud-automations.js [--group name] [--only-id automation-id] [--dry-run] [--test-to emails]');
  console.log('');
  console.log('Runs one cloud automation group or a single automation in the current environment.');
}

function resolveTestRecipients(raw) {
  if (!raw) {
    return null;
  }

  const recipients = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return recipients.length ? recipients : null;
}

function crmRetryLimits() {
  const configured = Number.parseInt(process.env.CRM_RESEARCH_LIMIT || '', 10);
  if (Number.isFinite(configured) && configured > 0) {
    const rounded = Math.max(1, configured);
    return [rounded, Math.min(rounded, 1200), 600, 300, 120, 60].filter(
      (value, index, array) => Number.isFinite(value) && value > 0 && array.indexOf(value) === index,
    );
  }
  return [2500, 1200, 600, 300, 120, 60];
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printUsage();
    return;
  }

  const automations = listCloudAutomations();
  const defaultGroup = args.group || process.env.CLOUD_AUTOMATION_GROUP || 'daily-7am';
  const testRecipients = resolveTestRecipients(args.testTo || process.env.TEST_TO || '');

  if (args.onlyId) {
    const automation = automations.find((item) => item.id === args.onlyId);
    if (!automation) {
      throw new Error(`Automation not found: ${args.onlyId}`);
    }

    console.log(`Running cloud automation ${automation.id} (${automation.label})`);
    const result = await runCloudAutomationById(automation.id, {
      runDate: new Date(),
      dryRun: args.dryRun,
      testRecipients,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  let lastError = null;
  const isMarketingCrm = defaultGroup === 'marketing-crm';

  const baseOptions = {
    runDate: new Date(),
    dryRun: args.dryRun,
    testRecipients,
  };

  const limitAttempts = isMarketingCrm
    ? crmRetryLimits().map((limit) => ({ ...baseOptions, crmResearchLimit: limit }))
    : [baseOptions];

  for (let index = 0; index < limitAttempts.length; index += 1) {
    const attemptOptions = limitAttempts[index];
    const attemptNumber = index + 1;
    try {
      if (isMarketingCrm && attemptOptions.crmResearchLimit) {
        console.log(
          `Running cloud automation group ${defaultGroup} (attempt ${attemptNumber}/${limitAttempts.length}, CRM_RESEARCH_LIMIT=${attemptOptions.crmResearchLimit})`,
        );
      } else {
        console.log(`Running cloud automation group ${defaultGroup}`);
      }
      const results = await runCloudAutomationGroup(defaultGroup, attemptOptions);
      console.log(JSON.stringify(results, null, 2));
      if (isMarketingCrm) {
        const crmResult = Array.isArray(results)
          ? results.find((item) => item && item.id === 'cold-email-crm')
          : null;
        if (crmResult?.result?.plan) {
          console.log('CRM segment top-up plan:');
          console.log(JSON.stringify(crmResult.result.plan, null, 2));
        }
        if (crmResult?.result?.existingCounts) {
          console.log('Existing CRM segment counts before run:');
          console.log(JSON.stringify(crmResult.result.existingCounts, null, 2));
        }
        if (crmResult?.result?.targets) {
          console.log('CRM target counts:');
          console.log(JSON.stringify(crmResult.result.targets, null, 2));
        }
      }
      return;
    } catch (error) {
      lastError = error;
      if (!isMarketingCrm) {
        break;
      }
      const limit = attemptOptions.crmResearchLimit;
      console.error(
        `marketing-crm attempt ${attemptNumber}/${limitAttempts.length} failed${limit ? ` at CRM_RESEARCH_LIMIT=${limit}` : ''}: ${error.message}`,
      );
    }
  }

  throw lastError || new Error(`Cloud automation group failed: ${defaultGroup}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
