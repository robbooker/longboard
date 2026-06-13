export type TalentCategoryId =
  | "finance"
  | "accounting"
  | "fundraising"
  | "investor-relations"
  | "technology"
  | "programming"
  | "data-analytics"
  | "ai-automation"
  | "product-management"
  | "operations"
  | "project-management"
  | "sales"
  | "business-development"
  | "partnerships"
  | "marketing"
  | "copywriting"
  | "content-creation"
  | "community-building"
  | "customer-success"
  | "teaching-coaching"
  | "web-design"
  | "general-design"
  | "brand-strategy"
  | "video-audio-production"
  | "legal-compliance"
  | "hr-recruiting"
  | "trading-market-knowledge"
  | "strategic-planning";

export type TalentCategory = {
  id: TalentCategoryId;
  label: string;
  group: "capital" | "build" | "growth" | "creative" | "people";
};

export const talentCategories: TalentCategory[] = [
  { id: "finance", label: "Finance", group: "capital" },
  { id: "accounting", label: "Accounting", group: "capital" },
  { id: "fundraising", label: "Fundraising", group: "capital" },
  { id: "investor-relations", label: "Investor relations", group: "capital" },
  { id: "technology", label: "Technology", group: "build" },
  { id: "programming", label: "Programming", group: "build" },
  { id: "data-analytics", label: "Data analytics", group: "build" },
  { id: "ai-automation", label: "AI / automation", group: "build" },
  { id: "product-management", label: "Product management", group: "build" },
  { id: "operations", label: "Operations", group: "build" },
  { id: "project-management", label: "Project management", group: "build" },
  { id: "sales", label: "Sales", group: "growth" },
  { id: "business-development", label: "Business development", group: "growth" },
  { id: "partnerships", label: "Partnerships", group: "growth" },
  { id: "marketing", label: "Marketing", group: "growth" },
  { id: "copywriting", label: "Copywriting", group: "growth" },
  { id: "content-creation", label: "Content creation", group: "creative" },
  { id: "web-design", label: "Web design", group: "creative" },
  { id: "general-design", label: "General design", group: "creative" },
  { id: "brand-strategy", label: "Brand strategy", group: "creative" },
  { id: "video-audio-production", label: "Video / audio production", group: "creative" },
  { id: "community-building", label: "Community building", group: "people" },
  { id: "customer-success", label: "Customer success", group: "people" },
  { id: "teaching-coaching", label: "Teaching / coaching", group: "people" },
  { id: "legal-compliance", label: "Legal / compliance", group: "people" },
  { id: "hr-recruiting", label: "HR / recruiting", group: "people" },
  { id: "trading-market-knowledge", label: "Trading / market knowledge", group: "people" },
  { id: "strategic-planning", label: "Strategic planning", group: "people" },
];

export const talentCategoryIds = new Set(talentCategories.map((category) => category.id));
