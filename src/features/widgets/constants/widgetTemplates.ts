/**
 * Widget Code Templates
 * 
 * Эти шаблоны используются как стартовая точка для создания custom виджетов.
 */

export const WIDGET_TEMPLATE = `export default function CustomWidget({ data, config }) {
  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">My Custom Widget</h2>
      
      {/* Display data count */}
      <p className="text-gray-600">
        Total items: {data?.length || 0}
      </p>
      
      {/* Example: List first 5 items */}
      <ul className="mt-4 space-y-2">
        {data?.slice(0, 5).map((item, i) => (
          <li key={i} className="p-2 bg-gray-100 rounded">
            {JSON.stringify(item)}
          </li>
        ))}
      </ul>
    </div>
  );
}`;

export const CHART_TEMPLATE = `export default function ChartWidget({ data, config }) {
  // Example: Simple bar chart with inline styles
  const maxValue = Math.max(...data.map(item => item.value || 0));
  
  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">{config.title || 'Chart'}</h2>
      
      <div className="space-y-2">
        {data.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-24 text-sm">{item.label}</span>
            <div className="flex-1 bg-gray-200 rounded h-6">
              <div 
                className="bg-blue-500 h-full rounded"
                style={{ width: \`\${(item.value / maxValue) * 100}%\` }}
              />
            </div>
            <span className="w-12 text-right text-sm">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}`;

export const TABLE_TEMPLATE = `export default function TableWidget({ data, config }) {
  if (!data || data.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500">
        No data available
      </div>
    );
  }
  
  const columns = Object.keys(data[0]);
  
  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">{config.title || 'Table'}</h2>
      
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-100">
              {columns.map(col => (
                <th key={col} className="border px-4 py-2 text-left">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} className="hover:bg-gray-50">
                {columns.map(col => (
                  <td key={col} className="border px-4 py-2">
                    {row[col]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}`;

export const STATS_TEMPLATE = `export default function StatsWidget({ data, config }) {
  const total = data?.length || 0;
  const sum = data?.reduce((acc, item) => acc + (item.value || 0), 0) || 0;
  const avg = total > 0 ? (sum / total).toFixed(2) : 0;
  
  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">{config.title || 'Statistics'}</h2>
      
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-blue-50 p-4 rounded">
          <div className="text-2xl font-bold text-blue-600">{total}</div>
          <div className="text-sm text-gray-600">Total Items</div>
        </div>
        
        <div className="bg-green-50 p-4 rounded">
          <div className="text-2xl font-bold text-green-600">{sum}</div>
          <div className="text-sm text-gray-600">Sum</div>
        </div>
        
        <div className="bg-purple-50 p-4 rounded">
          <div className="text-2xl font-bold text-purple-600">{avg}</div>
          <div className="text-sm text-gray-600">Average</div>
        </div>
      </div>
    </div>
  );
}`;

export const TEMPLATES = {
  basic: {
    name: 'Basic Widget',
    description: 'Simple widget template with data list',
    code: WIDGET_TEMPLATE,
  },
  chart: {
    name: 'Chart Widget',
    description: 'Bar chart visualization',
    code: CHART_TEMPLATE,
  },
  table: {
    name: 'Table Widget',
    description: 'Table view with auto-detected columns',
    code: TABLE_TEMPLATE,
  },
  stats: {
    name: 'Statistics Widget',
    description: 'Display total, sum, and average',
    code: STATS_TEMPLATE,
  },
};

export type TemplateKey = keyof typeof TEMPLATES;
