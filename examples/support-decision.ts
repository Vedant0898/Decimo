/**
 * One decision, shared by the examples below, to make the point that swapping a
 * provider never touches the decision.
 */

import { boolean, categorical, defineDecision, ordinal } from "../src/index";

export const supportDecision = defineDecision({
  intent: categorical({
    description: "Which department does this query belong to?",
    values: {
      billing: "Payments and invoices",
      technical: "Technical problems",
      sales: "Pricing and purchasing",
    },
  }),

  needsHuman: boolean({
    description: "Does this query require human intervention?",
  }),

  urgency: ordinal({
    description: "How urgent is this request?",
    // The array order is the scale.
    values: [
      { key: "low", description: "Can be handled normally" },
      { key: "medium", description: "Should be addressed soon" },
      { key: "high", description: "Requires prompt attention" },
    ],
  }),
});

export const supportState = {
  message: "My card was charged twice and nobody has replied.",
  customerTier: "premium",
  previousContacts: 0,
};
