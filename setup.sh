#!/bin/bash

echo "🚀 Starting Business CRM Setup"

cd /root/business-crm

# Install dependencies if not installed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install
fi

# Create .env if not exists
if [ ! -f ".env" ]; then
  echo "⚙️  Creating .env file..."
  cp .env.example .env
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📝 Next steps:"
echo "1. Edit .env file if needed: nano .env"
echo "2. Start the server: npm run dev"
echo "3. Open browser: http://localhost:3001"
echo ""
echo "📚 After registration, you can import services from CSV:"
echo "   node import-csv.js <path-to-csv> <business-id>"
echo ""
