import { authenticate } from "../shopify.server";
import {
  useLoaderData,
  useSubmit,
  useActionData,
  useNavigation,
} from "react-router";
import { useState, useCallback } from "react";

const DISCOUNT_TITLE = "Tier Discount Auto";
const NAMESPACE = "discount_config";
const KEY = "tier_settings";

const DEFAULT_CONFIG = {
  groups: [
    { group: "tier1", discount: 10 },
    { group: "tier2", discount: 20 },
    { group: "tier3", discount: 30 },
  ],
  excludedVariantIds: [],
};

const CREATE_SHOP_TIER_DEF = `
mutation {
  metafieldDefinitionCreate(
    definition: {
      name: "Tier Discount Settings"
      namespace: "discount_config"
      key: "tier_settings"
      type: "json"
      ownerType: SHOP
    }
  ) {
    userErrors { message }
  }
}
`;

const GET_SHOP_ID = `
  query {
    shop { id }
  }
`;

const GET_SHOP_FUNCTIONS = `
  query {
    shopifyFunctions(first: 10) {
      nodes { id title }
    }
  }
`;

const GET_AUTOMATIC_DISCOUNTS = `
  query {
    discountNodes(first: 50) {
      nodes {
        discount {
          __typename
          ... on DiscountAutomaticApp {
            title
            discountId
          }
        }
      }
    }
  }
`;

const GET_SHOP_CONFIG = `
  query {
    shop {
      metafield(namespace: "discount_config", key: "tier_settings") {
        value
      }
    }
  }
`;

const GET_PRODUCTS = `
  query {
    products(first: 100) {
      nodes {
        id
        title
        variants(first: 50) {
          nodes {
            id
            title
          }
        }
      }
    }
  }
`;

const SAVE_SHOP_CONFIG = `
  mutation ($ownerId: ID!, $value: String!) {
    metafieldsSet(
      metafields: [{
        ownerId: $ownerId
        namespace: "discount_config"
        key: "tier_settings"
        type: "json"
        value: $value
      }]
    ) {
      userErrors { message }
    }
  }
`;

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const shopId =
    (await (await admin.graphql(GET_SHOP_ID)).json()).data.shop.id;

  const functionId =
    (await (await admin.graphql(GET_SHOP_FUNCTIONS)).json())
      .data.shopifyFunctions.nodes.find(
        (f) => f.title === "discount-function"
      )?.id || null;

  const discountNode =
    (await (await admin.graphql(GET_AUTOMATIC_DISCOUNTS)).json())
      .data.discountNodes.nodes.find(
        (n) =>
          n.discount?.__typename === "DiscountAutomaticApp" &&
          n.discount?.title === "Tier Discount Auto"
      ) || null;

  const configValue =
    (await (await admin.graphql(GET_SHOP_CONFIG)).json())
      .data.shop.metafield?.value;

  const productsJson = await (
    await admin.graphql(GET_PRODUCTS)
  ).json();

  const products = [];
  productsJson.data.products.nodes.forEach((product) => {
    product.variants.nodes.forEach((variant) => {
      products.push({
        productId: product.id,
        productTitle: product.title,
        variantId: variant.id,
        variantTitle: variant.title,
        title: `${product.title} - ${variant.title}`,
      });
    });
  });

  return {
    shopId,
    functionId,
    discountId: discountNode?.discount?.discountId || null,
    discountExists: !!discountNode,
    config: configValue ? JSON.parse(configValue) : DEFAULT_CONFIG,
    products,
  };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();

  const groups = JSON.parse(form.get("groups"));
  const excludedVariantIds = JSON.parse(form.get("excludedVariantIds"));
  const discountId = form.get("discountId");
  const functionId = form.get("functionId");
  const shopId = form.get("shopId");

  try {
    const createDefinitionResponse = await admin.graphql(
      `#graphql
      mutation CreateCustomerDiscountGroupDefinition(
        $definition: MetafieldDefinitionInput!
      ) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition {
            id
            name
            namespace
            key
            ownerType
          }
          userErrors {
            field
            message
            code
          }
        }
      }
      `,
      {
        variables: {
          definition: {
            namespace: "custom",
            key: "customer_tier",
            name: "Discount group",
            description: "Which discount group this customer belongs to",
            type: "single_line_text_field",
            ownerType: "CUSTOMER",
          },
        },
      },
    );
  } catch (err) {
    console.error(
      "ACTION → Error while creating metafield definition (continuing anyway):",
      err,
    );
  }
 
  
  await admin.graphql(SAVE_SHOP_CONFIG, {
    variables: {
      ownerId: shopId,
      value: JSON.stringify({ groups, excludedVariantIds }),
    },
  });

  if (discountId) {
    await admin.graphql(
      `mutation ($id: ID!) {
        discountAutomaticDelete(id: $id) {
          deletedAutomaticDiscountId
        }
      }`,
      { variables: { id: discountId } }
    );
    await new Promise((r) => setTimeout(r, 1000));
  }

  const result = await admin.graphql(
    `mutation ($input: DiscountAutomaticAppInput!) {
      discountAutomaticAppCreate(automaticAppDiscount: $input) {
        automaticAppDiscount { discountId }
        userErrors { message }
      }
    }`,
    {
      variables: {
        input: {
          title: "Tier Discount Auto",
          functionId,
          startsAt: new Date().toISOString(),
          discountClasses: ["PRODUCT"],
          metafields: [
            {
              namespace: NAMESPACE,
              key: KEY,
              type: "json",
              value: JSON.stringify({ groups, excludedVariantIds }),
            },
          ],
        },
      },
    }
  );

  const json = await result.json();
  const errors =
    json?.data?.discountAutomaticAppCreate?.userErrors || [];

  if (errors.length) {
    return { success: false };
  }

  return { success: true };
};

export default function DiscountPage() {
  const {
    shopId,
    functionId,
    discountExists,
    discountId,
    config,
    products,
  } = useLoaderData();

  const submit = useSubmit();
  const nav = useNavigation();
  const actionData = useActionData();

  const [groups, setGroups] = useState(config.groups);
  const [excludedVariantIds, setExcludedVariantIds] = useState(
    config.excludedVariantIds
  );
  const [search, setSearch] = useState("");

  const toggleExclude = useCallback((variantId) => {
    setExcludedVariantIds((prev) =>
      prev.includes(variantId)
        ? prev.filter((id) => id !== variantId)
        : [...prev, variantId]
    );
  }, []);

  const removeGroup = useCallback(
    (indexToRemove) => {
      setGroups((prev) => prev.filter((_, i) => i !== indexToRemove));
    },
    [setGroups]
  );

  const handleSubmit = () => {
    const fd = new FormData();
    fd.append("groups", JSON.stringify(groups));
    fd.append("excludedVariantIds", JSON.stringify(excludedVariantIds));
    fd.append("discountId", discountId || "");
    fd.append("functionId", functionId || "");
    fd.append("shopId", shopId);
    submit(fd, { method: "post" });
  };

  const filteredProducts = products.filter((p) => {
    if (!search.trim()) return false;
    const q = search.toLowerCase();
    return (
      p.title.toLowerCase().includes(q) ||
      p.productTitle.toLowerCase().includes(q) ||
      p.variantTitle.toLowerCase().includes(q)
    );
  });

    const [showExcludeSearch, setShowExcludeSearch] = useState(false);
 
 
const excludedProducts = products.filter(p =>
  excludedVariantIds.includes(p.variantId)
);
 

  return (
    <div style={{ maxWidth: 900, margin: "40px auto", padding: 32 }}>
      <h1>Discount</h1>

      {/* Tier groups with remove button */}
      {groups.map((g, i) => (
        <div
          key={i}
          style={{ display: "flex", gap: 12, marginBottom: 10 }}
        >
          <input
            value={g.group}
            onChange={(e) => {
              const copy = [...groups];
              copy[i].group = e.target.value;
              setGroups(copy);
            }}
          />
          <input
            type="number"
            value={g.discount}
            onChange={(e) => {
              const copy = [...groups];
              copy[i].discount = Number(e.target.value);
              setGroups(copy);
            }}
          />
          {/* show remove button if there is more than one group */}
          {groups.length > 1 && (
            <button
              type="button"
              onClick={() => removeGroup(i)}
              style={{ padding: "0 8px" }}
            >
              ✕
            </button>
          )}
        </div>
      ))}

      <button
        onClick={() => setGroups([...groups, { group: "", discount: 0 }])}
      >
        Add Tier
      </button>

      <h3 style={{ marginTop: 32 }}>Exclude Products</h3>
 
      <button onClick={() => setShowExcludeSearch(true)}>
        Exclude Product
      </button>
      {showExcludeSearch && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#fff",
              padding: 24,
              width: 600,
              position: "relative",
            }}
          >
            <button
              onClick={() => setShowExcludeSearch(false)}
              style={{ position: "absolute", right: 12, top: 12 }}
            >
              ✕
            </button>
 
            <div style={{ display: "flex", gap: 8 }}>
              <input
                placeholder="Search products..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ flex: 1 }}
              />
              <button>Search</button>
            </div>
 
            <div style={{ marginTop: 16, maxHeight: 300, overflowY: "auto" }}>
              {filteredProducts.map((p) => (
                <div
                  key={p.variantId}
                  onClick={() => {
                    toggleExclude(p.variantId);
                    setShowExcludeSearch(false);
                  }}
                  style={{
                    padding: 8,
                    cursor: "pointer",
                    borderBottom: "1px solid #eee",
                  }}
                >
                  {p.title}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {excludedProducts.length > 0 && (
        <table style={{ width: "100%", marginTop: 20 }}>
          <thead>
            <tr>
              <th align="left">Sl.No</th>
              <th align="left">Product Name</th>
              <th align="left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {products
              .filter((p) => excludedVariantIds.includes(p.variantId))
              .map((p, i) => (
                <tr key={p.variantId}>
                  <td>{i + 1}</td>
                  <td>{p.title}</td>
                  <td>
                    <button onClick={() => toggleExclude(p.variantId)}>
                      X
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}

      <div style={{ marginTop: 24 }}>
        <button
          onClick={handleSubmit}
          disabled={nav.state === "submitting"}
        >
          {discountExists ? "Save Discount" : "Create Discount"}
        </button>
      </div>

      {actionData?.success && <p>Saved successfully</p>}
    </div>
  );
}
