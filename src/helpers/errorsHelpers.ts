import type { Contract } from 'ethers';

export function decodeContractError(contract: Contract, errorData: string) {
  const contractInterface = contract.interface;
  const selecter = errorData.slice(0, 10);
  const errorFragment = contractInterface.getError(selecter);
  const res = contractInterface.decodeErrorResult(errorFragment, errorData);
  const errorInputs = errorFragment.inputs;

  let message;
  if (errorInputs.length > 0) {
    message = errorInputs
      .map((input, index) => {
        return `${input.name}: ${res[index].toString()}`;
      })
      .join(', ');
  }

  throw new Error(`${errorFragment.name} | ${message ? message : ''}`);
}

export function handleError(contract: Contract, error: any) {
  if (error.error?.data?.data) {
    decodeContractError(contract, error.error.data.data);
  } else if (error.error?.error?.error?.data) {
    decodeContractError(contract, error.error.error.error.data);
  } else {
    console.trace(error);
  }
}
