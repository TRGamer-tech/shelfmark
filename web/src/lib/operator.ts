// Who runs this website and answers for it. The imprint and the privacy notice read it
// from here, so there is one place to fill in.
//
// The name and the postal address are empty on purpose until whoever runs the site
// writes them in. The pages show them only when they are there: nothing is made up.

export interface Operator {
  /** The person or body that answers for the site, as it is to appear. Empty: not shown. */
  name: string;
  /** The postal address, one entry per line. Empty: not shown. */
  address: string[];
  /** Where to write to. Always shown. */
  email: string;
}

export const OPERATOR: Operator = {
  name: "",
  address: [],
  email: "martin@schmidtbit.ch",
};

export interface OperatorBlock {
  /** Name and postal address, line by line. Empty when neither was filled in. */
  lines: string[];
  email: string;
}

/** What the pages print: the lines that are filled in, and the e-mail address. */
export function operatorBlock(operator: Operator = OPERATOR): OperatorBlock {
  const lines = [operator.name, ...operator.address].map((line) => line.trim()).filter((line) => line !== "");
  return { lines, email: operator.email.trim() };
}
