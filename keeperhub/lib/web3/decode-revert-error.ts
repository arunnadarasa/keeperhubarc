import { ethers } from "ethers";

/**
 * Well-known custom error selectors that appear frequently in contracts
 * but may not be included in the user-provided ABI (e.g. inherited from
 * OpenZeppelin base contracts).
 */
const COMMON_ERROR_FRAGMENTS: string[] = [
  "error Unauthorized()",
  "error OwnableUnauthorizedAccount(address account)",
  "error OwnableInvalidOwner(address owner)",
  "error EnforcedPause()",
  "error ExpectedPause()",
  "error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)",
  "error AccessControlBadConfirmation()",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InvalidSender(address sender)",
  "error ERC20InvalidReceiver(address receiver)",
  "error ERC20InvalidApprover(address approver)",
  "error ERC20InvalidSpender(address spender)",
  "error ERC721NonexistentToken(uint256 tokenId)",
  "error ERC721InsufficientApproval(address operator, uint256 tokenId)",
  "error FailedCall()",
  "error InsufficientBalance(uint256 balance, uint256 needed)",
  "error AddressInsufficientBalance(address account)",
  "error ReentrancyGuardReentrantCall()",
  "error InvalidInitialization()",
  "error NotInitializing()",
  "error MathOverflowedMulDiv()",
  "error SafeERC20FailedOperation(address token)",
  "error NotAuthorized()",
  "error InsufficientLiquidity()",
  "error InsufficientBalance()",
  "error InvalidAmount()",
  "error InvalidAddress()",
  "error Expired()",
  "error AlreadyInitialized()",
];

const COMMON_ERRORS_INTERFACE = new ethers.Interface(COMMON_ERROR_FRAGMENTS);

function formatDecodedError(decoded: ethers.ErrorDescription): string {
  if (decoded.args.length === 0) {
    return decoded.name;
  }
  const formattedArgs = decoded.args.map((arg: unknown) =>
    typeof arg === "bigint" ? arg.toString() : String(arg)
  );
  return `${decoded.name}(${formattedArgs.join(", ")})`;
}

/**
 * Attempt to decode revert data from an ethers.js CALL_EXCEPTION error.
 *
 * Tries three strategies in order:
 * 1. Parse against the contract's own ABI (catches contract-specific errors)
 * 2. Parse against common OpenZeppelin/standard error selectors
 * 3. Decode as a standard string revert reason (require("message"))
 *
 * Returns a human-readable string, or undefined if decoding fails entirely.
 */
export function decodeRevertReason(
  error: unknown,
  contractInterface?: ethers.Interface
): string | undefined {
  const revertData = extractRevertData(error);
  if (!revertData || revertData === "0x") {
    return;
  }

  // 1. Try the contract's own ABI
  if (contractInterface) {
    try {
      const decoded = contractInterface.parseError(revertData);
      if (decoded) {
        return formatDecodedError(decoded);
      }
    } catch {
      // Not in this ABI
    }
  }

  // 2. Try common error selectors
  try {
    const decoded = COMMON_ERRORS_INTERFACE.parseError(revertData);
    if (decoded) {
      return formatDecodedError(decoded);
    }
  } catch {
    // Not a known common error
  }

  // 3. Try standard string revert (Error(string))
  try {
    const reason = ethers.AbiCoder.defaultAbiCoder().decode(
      ["string"],
      ethers.dataSlice(revertData, 4)
    );
    if (reason[0]) {
      return String(reason[0]);
    }
  } catch {
    // Not a string revert
  }

  return;
}

/**
 * Build a user-facing error message for a contract call failure.
 *
 * If the revert data can be decoded, produces a message like:
 *   "Contract call failed: Unauthorized()"
 *
 * Otherwise falls back to the raw ethers.js error message.
 */
export function formatContractError(
  error: unknown,
  contractInterface?: ethers.Interface,
  prefix?: string
): string {
  const label = prefix ?? "Contract call failed";

  const decoded = decodeRevertReason(error, contractInterface);
  if (decoded) {
    return `${label}: ${decoded}`;
  }

  const message = error instanceof Error ? error.message : String(error);
  return `${label}: ${message}`;
}

function extractRevertData(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return;
  }
  const err = error as Record<string, unknown>;

  // ethers.js v6 CALL_EXCEPTION puts revert data in .data
  if (typeof err.data === "string" && err.data.startsWith("0x")) {
    return err.data;
  }

  // Some errors nest it under .error
  if (err.error && typeof err.error === "object") {
    return extractRevertData(err.error);
  }

  // Some RPC errors put it in .info.error.data
  if (err.info && typeof err.info === "object") {
    return extractRevertData(err.info);
  }

  return;
}
