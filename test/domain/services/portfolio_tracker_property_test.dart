import 'package:flutter_test/flutter_test.dart';
import 'package:kiri_check/kiri_check.dart';
import 'package:rally/domain/services/portfolio_tracker.dart';

/// Rounds a double to exactly 2 decimal places.
double _roundTo2(double value) {
  return double.parse(value.toStringAsFixed(2));
}

/// Feature: stock-trading-valuations-engine
/// Property-based tests for PortfolioTracker
void main() {
  group(
      'Feature: stock-trading-valuations-engine, '
      'Property 2: Invalid input rejection', () {
    // **Validates: Requirements 1.2**
    //
    // For any input where the quantity is outside [0.0001, 999999999],
    // has more than 4 decimal places, or is non-positive, OR the purchase
    // price is outside [0.01, 999999999.99], has more than 2 decimal places,
    // or is non-positive, OR the symbol is empty, the Portfolio_Tracker SHALL
    // reject the entry and return an error identifying the invalid field(s).

    property('rejects empty symbol', () {
      forAll(
        combine2(
          // Use integer-based values to avoid accidental decimal place violations
          integer(min: 1, max: 999999999),
          integer(min: 1, max: 999999999),
        ),
        (values) {
          final quantity = values.$1.toDouble();
          final price = values.$2.toDouble();
          final tracker = PortfolioTracker();

          final result = tracker.addHolding(
            symbol: '',
            quantity: quantity,
            averagePurchasePrice: price,
          );

          expect(result.isFailure, isTrue,
              reason: 'Empty symbol should be rejected');
          expect(result.error.toLowerCase(), contains('symbol'),
              reason: 'Error should mention symbol field');
        },
        maxExamples: 100,
      );
    });

    property('rejects quantity below minimum (< 0.0001)', () {
      forAll(
        combine2(
          // Generate quantities below minimum
          float(min: -1000000, max: 0.00009),
          // Use integer-based price to guarantee valid price
          integer(min: 1, max: 999999999),
        ),
        (values) {
          final quantity = values.$1;
          final price = values.$2.toDouble();
          final tracker = PortfolioTracker();

          final result = tracker.addHolding(
            symbol: 'AAPL',
            quantity: quantity,
            averagePurchasePrice: price,
          );

          expect(result.isFailure, isTrue,
              reason:
                  'Quantity $quantity below minimum should be rejected');
          expect(result.error.toLowerCase(), contains('quantity'),
              reason: 'Error should mention quantity field');
        },
        maxExamples: 100,
      );
    });

    property('rejects quantity above maximum (> 999999999)', () {
      forAll(
        combine2(
          float(min: 999999999.01, max: 9999999999),
          integer(min: 1, max: 999999999),
        ),
        (values) {
          final quantity = values.$1;
          final price = values.$2.toDouble();
          final tracker = PortfolioTracker();

          final result = tracker.addHolding(
            symbol: 'AAPL',
            quantity: quantity,
            averagePurchasePrice: price,
          );

          expect(result.isFailure, isTrue,
              reason:
                  'Quantity $quantity above maximum should be rejected');
          expect(result.error.toLowerCase(), contains('quantity'),
              reason: 'Error should mention quantity field');
        },
        maxExamples: 100,
      );
    });

    property('rejects quantity with more than 4 decimal places', () {
      forAll(
        combine3(
          // Integer part of quantity (0-999)
          integer(min: 0, max: 999),
          // 5-digit fractional part to guarantee 5 decimal places
          // Must not be divisible by 10 (would reduce to 4 decimals)
          integer(min: 1, max: 99999),
          // Use integer-based price to guarantee valid price
          integer(min: 1, max: 999999999),
        ),
        (values) {
          final intPart = values.$1;
          var fracPart = values.$2;
          final priceInt = values.$3;

          // Ensure fracPart is not divisible by 10 (so it truly has 5 digits)
          if (fracPart % 10 == 0) fracPart += 1;

          // Construct a quantity with exactly 5 decimal places
          final quantity = intPart + fracPart / 100000.0;
          final price = priceInt.toDouble();

          // Only test if the quantity is within valid range
          if (quantity < 0.0001 || quantity > 999999999) return;

          final tracker = PortfolioTracker();
          final result = tracker.addHolding(
            symbol: 'AAPL',
            quantity: quantity,
            averagePurchasePrice: price,
          );

          expect(result.isFailure, isTrue,
              reason:
                  'Quantity $quantity with >4 decimal places should be rejected');
          expect(result.error.toLowerCase(), contains('quantity'),
              reason: 'Error should mention quantity field');
        },
        maxExamples: 100,
      );
    });

    property('rejects price below minimum (< 0.01)', () {
      forAll(
        combine2(
          // Use integer-based quantity to guarantee valid quantity
          integer(min: 1, max: 999999999),
          // Generate prices below minimum
          float(min: -1000000, max: 0.009),
        ),
        (values) {
          final quantity = values.$1.toDouble();
          final price = values.$2;
          final tracker = PortfolioTracker();

          final result = tracker.addHolding(
            symbol: 'AAPL',
            quantity: quantity,
            averagePurchasePrice: price,
          );

          expect(result.isFailure, isTrue,
              reason: 'Price $price below minimum should be rejected');
          expect(result.error.toLowerCase(), contains('averagepurchaseprice'),
              reason: 'Error should mention averagePurchasePrice field');
        },
        maxExamples: 100,
      );
    });

    property('rejects price above maximum (> 999999999.99)', () {
      forAll(
        combine2(
          integer(min: 1, max: 999999999),
          float(min: 1000000000, max: 9999999999),
        ),
        (values) {
          final quantity = values.$1.toDouble();
          final price = values.$2;
          final tracker = PortfolioTracker();

          final result = tracker.addHolding(
            symbol: 'AAPL',
            quantity: quantity,
            averagePurchasePrice: price,
          );

          expect(result.isFailure, isTrue,
              reason: 'Price $price above maximum should be rejected');
          expect(result.error.toLowerCase(), contains('averagepurchaseprice'),
              reason: 'Error should mention averagePurchasePrice field');
        },
        maxExamples: 100,
      );
    });

    property('rejects price with more than 2 decimal places', () {
      forAll(
        combine3(
          // Use integer-based quantity to guarantee valid quantity
          integer(min: 1, max: 999999999),
          // Integer part of price (0-999999999)
          integer(min: 0, max: 999999999),
          // 3-digit fractional part to guarantee 3 decimal places
          // Must not be divisible by 10 (would reduce to 2 decimals)
          integer(min: 1, max: 999),
        ),
        (values) {
          final quantityInt = values.$1;
          final intPart = values.$2;
          var fracPart = values.$3;
          final quantity = quantityInt.toDouble();

          // Ensure fracPart is not divisible by 10 (so it truly has 3 digits)
          if (fracPart % 10 == 0) fracPart += 1;

          // Construct a price with exactly 3 decimal places
          final price = intPart + fracPart / 1000.0;

          // Only test if the price is within valid range
          if (price < 0.01 || price > 999999999.99) return;

          final tracker = PortfolioTracker();
          final result = tracker.addHolding(
            symbol: 'AAPL',
            quantity: quantity,
            averagePurchasePrice: price,
          );

          expect(result.isFailure, isTrue,
              reason:
                  'Price $price with >2 decimal places should be rejected');
          expect(result.error.toLowerCase(), contains('averagepurchaseprice'),
              reason: 'Error should mention averagePurchasePrice field');
        },
        maxExamples: 100,
      );
    });

    property('reports all invalid fields when multiple inputs are invalid', () {
      forAll(
        combine2(
          float(min: -1000000, max: 0.00009),
          float(min: -1000000, max: 0.009),
        ),
        (values) {
          final quantity = values.$1;
          final price = values.$2;
          final tracker = PortfolioTracker();

          final result = tracker.addHolding(
            symbol: '',
            quantity: quantity,
            averagePurchasePrice: price,
          );

          expect(result.isFailure, isTrue,
              reason: 'Multiple invalid fields should be rejected');
          final errorLower = result.error.toLowerCase();
          expect(errorLower, contains('symbol'),
              reason: 'Error should mention symbol field');
          expect(errorLower, contains('quantity'),
              reason: 'Error should mention quantity field');
          expect(errorLower, contains('averagepurchaseprice'),
              reason: 'Error should mention averagePurchasePrice field');
        },
        maxExamples: 100,
      );
    });
  });

  group(
      'Feature: stock-trading-valuations-engine, '
      'Property 3: Weighted average calculation', () {
    // **Validates: Requirements 1.3**
    //
    // For any existing holding with quantity Q1 and average price P1, and a new
    // addition with quantity Q2 and price P2, the resulting average price SHALL
    // equal (Q1 * P1 + Q2 * P2) / (Q1 + Q2) and the resulting total quantity
    // SHALL equal Q1 + Q2.

    property(
        'resulting quantity equals Q1 + Q2 and average price equals weighted average',
        () {
      forAll(
        combine4(
          // Q1: quantity for first holding, as integer divided by 10000
          // gives values in [0.0001, 49999.9999] with ≤4 decimal places
          integer(min: 1, max: 499999999),
          // P1: price for first holding, as integer divided by 100
          // gives values in [0.01, 999999999.99] with ≤2 decimal places
          integer(min: 1, max: 99999999999),
          // Q2: quantity for second addition
          integer(min: 1, max: 499999999),
          // P2: price for second addition
          integer(min: 1, max: 99999999999),
        ),
        (values) {
          final (q1Int, p1Int, q2Int, p2Int) = values;

          // Convert to valid quantities with ≤4 decimal places
          final q1 = q1Int / 10000.0;
          final q2 = q2Int / 10000.0;
          // Convert to valid prices with ≤2 decimal places
          final p1 = p1Int / 100.0;
          final p2 = p2Int / 100.0;

          // Ensure Q1 + Q2 doesn't exceed max allowed quantity (999999999)
          if (q1 + q2 > 999999999) return;

          // Create a fresh tracker for each iteration
          final tracker = PortfolioTracker();

          // Step 1: Add first holding with (symbol, Q1, P1)
          final result1 = tracker.addHolding(
            symbol: 'TEST',
            quantity: q1,
            averagePurchasePrice: p1,
          );
          expect(result1.isSuccess, isTrue,
              reason: 'First addHolding failed: q1=$q1, p1=$p1');

          // Step 2: Add same symbol again with (symbol, Q2, P2)
          final result2 = tracker.addHolding(
            symbol: 'TEST',
            quantity: q2,
            averagePurchasePrice: p2,
          );
          expect(result2.isSuccess, isTrue,
              reason: 'Second addHolding failed: q2=$q2, p2=$p2');

          final holding = result2.value;

          // Step 3: Verify total quantity equals Q1 + Q2
          final expectedQuantity = q1 + q2;
          expect(holding.quantity, closeTo(expectedQuantity, 1e-9),
              reason:
                  'Quantity mismatch: expected $expectedQuantity, got ${holding.quantity}');

          // Step 4: Verify weighted average price =
          //   (Q1 * P1 + Q2 * P2) / (Q1 + Q2)
          final expectedAvgPrice = (q1 * p1 + q2 * p2) / (q1 + q2);
          expect(
              holding.averagePurchasePrice, closeTo(expectedAvgPrice, 1e-6),
              reason:
                  'Average price mismatch: expected $expectedAvgPrice, got ${holding.averagePurchasePrice}');
        },
        maxExamples: 100,
      );
    });
  });

  group(
      'Feature: stock-trading-valuations-engine, '
      'Property 4: Portfolio valuation arithmetic', () {
    // **Validates: Requirements 1.4**
    //
    // For any holding with quantity Q, average purchase price P_avg, and
    // current market price P_current, the total value SHALL equal
    // P_current * Q and the unrealized gain/loss SHALL equal
    // (P_current - P_avg) * Q, both rounded to 2 decimal places.
    property(
        'totalValue == roundTo2(P_current * Q) and '
        'unrealizedGainLoss == roundTo2((P_current - P_avg) * Q)', () {
      forAll(
        combine3(
          // quantity: valid range [0.0001, 999999999] with up to 4 decimal places
          // Using a smaller max to avoid floating-point overflow in multiplication
          float(min: 0.0001, max: 100000.0, nan: false, infinity: false),
          // averagePurchasePrice: valid range [0.01, 999999999.99]
          float(min: 0.01, max: 100000.0, nan: false, infinity: false),
          // currentPrice: reasonable market price range
          float(min: 0.01, max: 100000.0, nan: false, infinity: false),
        ),
        (tuple) {
          final rawQuantity = tuple.$1;
          final rawAvgPrice = tuple.$2;
          final pCurrent = _roundTo2(tuple.$3);

          // Constrain quantity to at most 4 decimal places
          final quantity = double.parse(rawQuantity.toStringAsFixed(4));
          // Constrain avgPrice to at most 2 decimal places
          final pAvg = _roundTo2(rawAvgPrice);

          // Skip values that fall outside the valid domain after rounding
          if (quantity < 0.0001 || pAvg < 0.01 || pCurrent < 0.01) return;

          final tracker = PortfolioTracker();

          final addResult = tracker.addHolding(
            symbol: 'TEST',
            quantity: quantity,
            averagePurchasePrice: pAvg,
          );

          // Should succeed since we constrained inputs to valid ranges
          expect(addResult.isSuccess, isTrue,
              reason: 'addHolding should succeed for Q=$quantity, P_avg=$pAvg');

          final summary = tracker.recalculate({'TEST': pCurrent});

          expect(summary.holdings.length, equals(1));
          final valuation = summary.holdings.first;

          final expectedTotalValue = _roundTo2(pCurrent * quantity);
          final expectedGainLoss = _roundTo2((pCurrent - pAvg) * quantity);

          expect(valuation.totalValue, equals(expectedTotalValue),
              reason:
                  'totalValue should be roundTo2($pCurrent * $quantity) = '
                  '$expectedTotalValue, got ${valuation.totalValue}');
          expect(valuation.unrealizedGainLoss, equals(expectedGainLoss),
              reason:
                  'unrealizedGainLoss should be roundTo2(($pCurrent - $pAvg) '
                  '* $quantity) = $expectedGainLoss, '
                  'got ${valuation.unrealizedGainLoss}');
        },
        maxExamples: 100,
      );
    });
  });
}
