import {
  DiscountClass,
  ProductDiscountSelectionStrategy,
} from "../generated/api";

/**
 * @param {import("../generated/api").CartInput} input
 * @returns {import("../generated/api").CartLinesDiscountsGenerateRunResult}
 */
export function cartLinesDiscountsGenerateRun(input) {
  if (!input.cart.lines.length) {
    return { operations: [] };
  }

  if (!input.discount.discountClasses.includes(DiscountClass.Product)) {
    return { operations: [] };
  }

  if (!input.discount.metafield?.value) {
    return { operations: [] };
  }

  let config;
  try {
    config = JSON.parse(input.discount.metafield.value);
  } catch {
    return { operations: [] };
  }

  if (!config.groups || config.groups.length === 0) {
    return { operations: [] };
  }

  const customerTier =
    input.cart.buyerIdentity?.customer?.metafield?.value;

  if (!customerTier) {
    return { operations: [] };
  }

  const normalizedTier = customerTier.toLowerCase().trim();

  const matchedGroup = config.groups.find(
    (group) =>
      group.group &&
      group.group.toLowerCase().trim() === normalizedTier
  );

  if (!matchedGroup || !matchedGroup.discount || matchedGroup.discount <= 0) {
    return { operations: [] };
  }

  const eligibleLines = input.cart.lines.filter((line) => {
    if (line.merchandise.__typename !== "ProductVariant") {
      return false;
    }
    return !config.excludedVariantIds.includes(line.merchandise.id);
  });

  if (!eligibleLines.length) {
    return { operations: [] };
  }

  const candidates = eligibleLines.map((line) => ({
    message: `${matchedGroup.discount}% ${customerTier.toUpperCase()} Discount`,
    targets: [{ cartLine: { id: line.id } }],
    value: {
      percentage: {
        value: matchedGroup.discount,
      },
    },
  }));

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates,
          selectionStrategy: ProductDiscountSelectionStrategy.All,
        },
      },
    ],
  };
}
