import { Transaction, Address, Operation, xdr } from "@stellar/stellar-sdk";
import { Api, assembleTransaction } from "@stellar/stellar-sdk/rpc";

export function handleSimulationResult(simulation?: Api.SimulateTransactionResponse) {
  if (!simulation) {
    throw new Error("Simulation result is undefined");
  }
  if (Api.isSimulationError(simulation)) {
    throw new Error(`Stellar simulation failed: ${simulation.error}`);
  }
}

export type ContractSigners = {
  alreadySigned: string[];
  pendingSignature: string[];
};

export type GatherAuthEntrySignatureStatusInput = {
  transaction: Transaction;
  simulationResponse?: Api.SimulateTransactionResponse;
  simulate?: boolean;
};

export function gatherAuthEntrySignatureStatus({
  transaction,
  simulationResponse,
  simulate,
}: GatherAuthEntrySignatureStatusInput): ContractSigners {
  const shouldAssemble = simulate ?? simulationResponse !== undefined;
  let assembledTx = transaction;
  if (shouldAssemble && simulationResponse) {
    assembledTx = assembleTransaction(transaction, simulationResponse).build();
  }
  if (assembledTx.operations.length !== 1) {
    throw new Error(`Expected one operation, got ${assembledTx.operations.length}`);
  }
  const operation = assembledTx.operations[0];
  if (operation.type !== "invokeHostFunction") {
    throw new Error(`Expected invokeHostFunction, got ${operation.type}`);
  }
  const invokeOp = operation as Operation.InvokeHostFunction;
  const alreadySigned: string[] = [];
  const pendingSignature: string[] = [];
  for (const entry of invokeOp.auth ?? []) {
    const credentialsType = entry.credentials().switch();
    if (credentialsType === xdr.SorobanCredentialsType.sorobanCredentialsSourceAccount()) {
      continue;
    }
    if (credentialsType === xdr.SorobanCredentialsType.sorobanCredentialsAddress()) {
      const addressCredentials = entry.credentials().address();
      const address = Address.fromScAddress(addressCredentials.address()).toString();
      const signature = addressCredentials.signature();
      const isSigned = signature.switch().name !== "scvVoid";
      if (isSigned) {
        alreadySigned.push(address);
      } else {
        pendingSignature.push(address);
      }
    }
  }
  return {
    alreadySigned: [...new Set(alreadySigned)],
    pendingSignature: [...new Set(pendingSignature)],
  };
}
