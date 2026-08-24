-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "oldPrice" REAL,
    "discount" INTEGER,
    "category" TEXT NOT NULL,
    "store" TEXT NOT NULL,
    "affiliateLink" TEXT NOT NULL,
    "mlId" TEXT NOT NULL,
    "rating" REAL,
    "sales" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_mlId_key" ON "Product"("mlId");
