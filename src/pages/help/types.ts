export interface HelpSection {
  id: string;
  title: string;
  icon: React.ReactNode;
}

export interface ColumnTypeDetails {
  features: string[];
  settings: { name: string; desc: string }[];
  example: string;
}
