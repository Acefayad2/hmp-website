const snapshot = (value) => JSON.stringify(value);

export const createProposalDirtyState = ({ read, isOpen }) => {
  let baseline = null;

  return {
    begin() {
      baseline = snapshot(read());
    },
    markSaved(value = read()) {
      baseline = snapshot(value);
    },
    reset() {
      baseline = null;
    },
    isDirty() {
      return baseline !== null && isOpen() && snapshot(read()) !== baseline;
    },
  };
};
