import { EvalCase } from './types';

/**
 * 20 eval cases organized by category.
 * These are seeded into LangSmith as a dataset.
 *
 * Session IDs use a prefix so multi-turn cases share a session,
 * and single-turn cases each get a unique session.
 */

// --- Market Data (5 cases) ---
const marketDataCases: EvalCase[] = [
  {
    inputs: { message: "What's the current price of AAPL?", session_id: 'eval-market-1' },
    outputs: { expectedTool: 'market_data_fetch', expectedPatterns: ['AAPL', '\\$\\d+'], category: 'market_data' }
  },
  {
    inputs: { message: 'Compare MSFT and GOOGL prices', session_id: 'eval-market-2' },
    outputs: { expectedTool: 'market_data_fetch', expectedPatterns: ['MSFT', 'GOOGL', '\\$\\d+'], category: 'market_data' }
  },
  {
    inputs: { message: "What's the PE ratio of TSLA?", session_id: 'eval-market-3' },
    outputs: { expectedTool: 'market_data_fetch', expectedPatterns: ['TSLA'], category: 'market_data' }
  },
  {
    inputs: { message: 'Price of BTC-USD', session_id: 'eval-market-4' },
    outputs: { expectedTool: 'market_data_fetch', expectedPatterns: ['BTC'], category: 'market_data' }
  },
  {
    inputs: { message: 'Price of INVALIDXYZ', session_id: 'eval-market-5' },
    outputs: { expectedTool: 'market_data_fetch', expectedPatterns: ['INVALIDXYZ'], category: 'market_data' }
  }
];

// --- Portfolio Analysis (5 cases) ---
const portfolioCases: EvalCase[] = [
  {
    inputs: { message: "What's my portfolio risk?", session_id: 'eval-portfolio-1' },
    outputs: { expectedTool: 'portfolio_risk_analysis', expectedPatterns: ['HHI|Herfindahl|concentration', 'Diversifi'], category: 'portfolio' }
  },
  {
    inputs: { message: 'Show my asset allocation', session_id: 'eval-portfolio-2' },
    outputs: { expectedTool: 'portfolio_risk_analysis', expectedPatterns: ['Allocation', '%'], category: 'portfolio' }
  },
  {
    inputs: { message: 'How concentrated is my portfolio?', session_id: 'eval-portfolio-3' },
    outputs: { expectedTool: 'portfolio_risk_analysis', expectedPatterns: ['concentration|concentrated', '%'], category: 'portfolio' }
  },
  {
    inputs: { message: 'How has my portfolio performed?', session_id: 'eval-portfolio-4' },
    outputs: { expectedTool: 'portfolio_risk_analysis', expectedPatterns: ['return|performance|performed', '\\$'], category: 'portfolio' }
  },
  {
    inputs: { message: 'Am I diversified enough?', session_id: 'eval-portfolio-5' },
    outputs: { expectedTool: 'portfolio_risk_analysis', expectedPatterns: ['Diversifi', 'HHI|Herfindahl|concentration'], category: 'portfolio' }
  }
];

// --- Compliance (5 cases) ---
const complianceCases: EvalCase[] = [
  {
    inputs: { message: 'Run an ESG compliance check', session_id: 'eval-compliance-1' },
    outputs: { expectedTool: 'compliance_check', expectedPatterns: ['Compliance Score', '%', 'XOM|Exxon'], category: 'compliance' }
  },
  {
    inputs: { message: 'Check for fossil fuel exposure', session_id: 'eval-compliance-2' },
    outputs: { expectedTool: 'compliance_check', expectedPatterns: ['fossil fuel', 'XOM|Exxon'], category: 'compliance' }
  },
  {
    inputs: { message: 'Are my holdings ethical?', session_id: 'eval-compliance-3' },
    outputs: { expectedTool: 'compliance_check', expectedPatterns: ['Compliance', '%'], category: 'compliance' }
  },
  {
    inputs: { message: 'Any weapons companies in my portfolio?', session_id: 'eval-compliance-4' },
    outputs: { expectedTool: 'compliance_check', expectedPatterns: ['weapon'], category: 'compliance' }
  },
  {
    inputs: { message: 'Give me my compliance score', session_id: 'eval-compliance-5' },
    outputs: { expectedTool: 'compliance_check', expectedPatterns: ['Compliance Score', '\\d+%'], category: 'compliance' }
  }
];

// --- Multi-turn (3 cases — each is an array of turns) ---
// Multi-turn cases are handled specially by the eval runner.
// We encode them as the SECOND turn only; the runner sends the first turn
// beforehand using the same session_id.
export interface MultiTurnCase {
  turns: Array<{ message: string }>;
  session_id: string;
  expectedTool: string | null;
  expectedPatterns: string[];
  category: 'multi_turn';
}

export const multiTurnCases: MultiTurnCase[] = [
  {
    turns: [
      { message: 'What is the price of AAPL?' },
      { message: 'What about MSFT?' }
    ],
    session_id: 'eval-multi-1',
    expectedTool: 'market_data_fetch',
    expectedPatterns: ['MSFT', '\\$\\d+'],
    category: 'multi_turn'
  },
  {
    turns: [
      { message: "What's my portfolio risk?" },
      { message: 'Now check ESG compliance' }
    ],
    session_id: 'eval-multi-2',
    expectedTool: 'compliance_check',
    expectedPatterns: ['Compliance', '%'],
    category: 'multi_turn'
  },
  {
    turns: [
      { message: 'Price of AAPL' },
      { message: 'Is that higher than last year?' }
    ],
    session_id: 'eval-multi-3',
    expectedTool: null, // May or may not invoke a tool
    expectedPatterns: ['AAPL|price|higher|year'],
    category: 'multi_turn'
  }
];

// --- Error Recovery (2 cases) ---
const errorCases: EvalCase[] = [
  {
    inputs: { message: '', session_id: 'eval-error-1' },
    outputs: { expectedTool: null, expectedPatterns: ['provide|message|Please'], category: 'error' }
  },
  {
    inputs: { message: 'Write me a poem about stocks', session_id: 'eval-error-2' },
    outputs: { expectedTool: null, expectedPatterns: ['help|ESG|portfolio|market|ticker'], category: 'error' }
  }
];

/** All single-turn eval cases (17 total) */
export const singleTurnCases: EvalCase[] = [
  ...marketDataCases,
  ...portfolioCases,
  ...complianceCases,
  ...errorCases
];

/** Total case count for reporting */
export const TOTAL_CASES = singleTurnCases.length + multiTurnCases.length; // 20
