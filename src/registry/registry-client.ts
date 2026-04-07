import { 
  rpc, 
  Address, 
  contract, 
  nativeToScVal, 
  scValToNative, 
  TransactionBuilder,
  xdr,
  Operation,
  Account
} from "@stellar/stellar-sdk";
import { getNetworkPassphrase, getRpcClient, convertToTokenAmount } from "../stellar/utils.js";
import { createEd25519Signer } from "../stellar/signer.js";
import { handleSimulationResult } from "../stellar/shared.js";

export interface ServiceEntry {
  url: string;
  name: string;
  description: string;
  priceUsdc: bigint;
  inputSchema: string;
  outputSchema: string;
  owner: string;
  verified: boolean;
  totalPayments: bigint;
}

export class AuthoraRegistryClient {
  /**
   * Registers a new service in the Authora registry.
   */
  async registerService(params: {
    secretKey: string;
    network: string;
    rpcUrl: string;
    contractId: string;
    service: {
      url: string;
      name: string;
      description: string;
      priceUsdc: number;
      inputSchema: string;
      outputSchema: string;
    };
  }): Promise<{ success: boolean; txHash: string }> {
    const { secretKey, network, rpcUrl, contractId, service } = params;
    const networkPassphrase = getNetworkPassphrase(network as any);
    const signer = createEd25519Signer(secretKey, network as any);

    // Convert decimal USDC to stroops (7 decimals)
    const stroops = convertToTokenAmount(service.priceUsdc.toString(), 7);

    const tx = await contract.AssembledTransaction.build({
      contractId: contractId as any,
      method: "register_service",
      args: [
        nativeToScVal(signer.address, { type: "address" }), // caller
        xdr.ScVal.scvMap([
          new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("description"), val: nativeToScVal(service.description, { type: "string" }) }),
          new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("input_schema"), val: nativeToScVal(service.inputSchema, { type: "string" }) }),
          new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("name"), val: nativeToScVal(service.name, { type: "string" }) }),
          new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("output_schema"), val: nativeToScVal(service.outputSchema, { type: "string" }) }),
          new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("owner"), val: nativeToScVal(signer.address, { type: "address" }) }),
          new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("price_usdc"), val: nativeToScVal(BigInt(stroops), { type: "i128" }) }),
          new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("total_payments"), val: nativeToScVal(0n, { type: "u64" }) }),
          new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("url"), val: nativeToScVal(service.url, { type: "string" }) }),
          new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("verified"), val: nativeToScVal(false, { type: "bool" }) })
        ]),
      ],
      networkPassphrase: networkPassphrase as any,
      rpcUrl,
      publicKey: signer.address,
      parseResultXdr: result => result,
    });

    handleSimulationResult(tx.simulation);
    
    // Sign and submit
    try {
      await tx.signAuthEntries({
        address: signer.address,
        signAuthEntry: signer.signAuthEntry,
      });
    } catch(e) { /* ignore if already signed or not needed */ }

    const sendResult: any = await tx.signAndSend({ signTransaction: signer.signTransaction as any });
    
    const txHash = sendResult.sendTransactionResponse?.hash || "";
    const success = sendResult.getTransactionResponseAll?.some((r: any) => r.status === "SUCCESS") 
                 || sendResult.sendTransactionResponse?.status === "SUCCESS";

    return {
      success,
      txHash,
    };
  }

  /**
   * Returns a paginated list of registered services.
   */
  async listServices(params: {
    rpcUrl: string;
    contractId: string;
    offset?: number;
    limit?: number;
  }): Promise<ServiceEntry[]> {
    const { rpcUrl, contractId, offset = 0, limit = 10 } = params;
    const server = new rpc.Server(rpcUrl);

    const invokeOp = Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeInvokeContract(
        new xdr.InvokeContractArgs({
          contractAddress: Address.fromString(contractId as any).toScAddress(),
          functionName: "list_services",
          args: [
            nativeToScVal(offset, { type: "u32" }),
            nativeToScVal(limit, { type: "u32" }),
          ],
        })
      ),
      auth: [],
    });

    const tx = new TransactionBuilder(new Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF" as any, "0"), {
      fee: "100",
      networkPassphrase: "Test SDF Network ; September 2015" as any,
    })
      .addOperation(invokeOp)
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(result)) {
       return [];
    }

    const entries = scValToNative(result.result!.retval) as any[];
    return entries.map(this.mapToEntry);
  }

  /**
   * Fetches a specific service details by its URL.
   */
  async getService(params: {
    rpcUrl: string;
    contractId: string;
    url: string;
  }): Promise<ServiceEntry | null> {
    const { rpcUrl, contractId, url } = params;
    const server = new rpc.Server(rpcUrl);

    const invokeOp = Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeInvokeContract(
        new xdr.InvokeContractArgs({
          contractAddress: Address.fromString(contractId as any).toScAddress(),
          functionName: "get_service",
          args: [nativeToScVal(url, { type: "string" })],
        })
      ),
      auth: [],
    });

    const tx = new TransactionBuilder(new Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF" as any, "0"), {
      fee: "100",
      networkPassphrase: "Test SDF Network ; September 2015" as any,
    })
      .addOperation(invokeOp)
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(result) || !result.result?.retval) {
       return null;
    }

    const entry = scValToNative(result.result.retval);
    return entry ? this.mapToEntry(entry) : null;
  }

  /**
   * Returns the total count of registered services.
   */
  async serviceCount(params: {
    rpcUrl: string;
    contractId: string;
  }): Promise<number> {
    const { rpcUrl, contractId } = params;
    const server = new rpc.Server(rpcUrl);

    const invokeOp = Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeInvokeContract(
        new xdr.InvokeContractArgs({
          contractAddress: Address.fromString(contractId as any).toScAddress(),
          functionName: "service_count",
          args: [],
        })
      ),
      auth: [],
    });

    const tx = new TransactionBuilder(new Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF" as any, "0"), {
      fee: "100",
      networkPassphrase: "Test SDF Network ; September 2015" as any,
    })
      .addOperation(invokeOp)
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(result) || !result.result?.retval) {
       return 0;
    }

    return scValToNative(result.result.retval) as number;
  }

  /**
   * Records a verified payment. Used by operators.
   */
  async recordPayment(params: {
    secretKey: string;
    rpcUrl: string;
    contractId: string;
    url: string;
    payerAddress: string;
    network: string;
  }): Promise<void> {
    const { secretKey, rpcUrl, contractId, url, payerAddress, network } = params;
    const networkPassphrase = getNetworkPassphrase(network as any);
    const signer = createEd25519Signer(secretKey, network as any);

    const tx = await contract.AssembledTransaction.build({
      contractId: contractId as any,
      method: "record_payment",
      args: [
        nativeToScVal(url, { type: "string" }),
        nativeToScVal(payerAddress, { type: "address" }),
      ],
      rpcUrl,
      networkPassphrase: networkPassphrase as any,
      publicKey: signer.address,
      parseResultXdr: result => result,
    });

    handleSimulationResult(tx.simulation);
    await tx.signAndSend({ signTransaction: signer.signTransaction as any });
  }

  private mapToEntry(raw: any): ServiceEntry {
    return {
      url: raw.url.toString(),
      name: raw.name.toString(),
      description: raw.description.toString(),
      priceUsdc: BigInt(raw.price_usdc),
      inputSchema: raw.input_schema.toString(),
      outputSchema: raw.output_schema.toString(),
      owner: raw.owner.toString(),
      verified: Boolean(raw.verified),
      totalPayments: BigInt(raw.total_payments),
    };
  }
}
