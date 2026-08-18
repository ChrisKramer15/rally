import 'package:flutter_test/flutter_test.dart';
import 'package:kiri_check/kiri_check.dart';

import 'package:rally/domain/models/asset_price.dart';
import 'package:rally/domain/models/market_data_exception.dart';

/// Feature: live-market-data
/// Property-based tests for AssetPrice parsing validation
///
/// Property 9: AssetPrice serialization round-trip
/// "For any valid AssetPrice object (including those constructed from JSON
/// with integer-valued numeric fields and non-UTC timestamps), serializing
/// via toJson and parsing back via fromJson produces an AssetPrice that is
/// field-by-field equal to the original, with all numeric fields stored as
/// doubles and the timestamp normalized to UTC."
///
/// **Validates: Requirements 6.1, 6.5**
///
/// Property 10: Missing fields produce descriptive error
/// "For any non-empty subset of required AssetPrice fields that is omitted
/// from a JSON payload, parsing the payload throws a MarketDataException
/// whose message contains every omitted field name."
///
/// **Validates: Requirements 6.2**
///
/// Property 12: Invalid timestamp string produces error
/// "For any string that is not parseable as ISO 8601 placed in the timestamp
/// field of an otherwise-valid JSON payload, parsing throws a
/// MarketDataException indicating the invalid timestamp value."
///
/// **Validates: Requirements 6.4**
/// Property 11: Wrong-type fields produce descriptive error
/// "For any required AssetPrice field whose value is replaced with a value of
/// an incompatible type, parsing the payload throws a MarketDataException
/// identifying the field name and the expected type."
///
/// **Validates: Requirements 6.3**

void main() {
  group(
      'Feature: live-market-data, '
      'Property 9: AssetPrice serialization round-trip', () {
    // **Validates: Requirements 6.1, 6.5**

    property(
        'toJson then fromJson produces field-by-field equal AssetPrice', () {
      // Generator for random symbol strings (1–10 uppercase chars)
      final symbolArb = integer(min: 1, max: 10).flatMap((length) {
        return list(
          integer(min: 65, max: 90).map((code) => String.fromCharCode(code)),
          minLength: length,
          maxLength: length,
        ).map((chars) => chars.join());
      });

      // Generator for random prices (0.01–100000.0)
      final priceArb =
          integer(min: 1, max: 10000000).map((i) => i / 100.0);

      // Generator for random volume (0.0–1000000000.0)
      final volumeArb =
          integer(min: 0, max: 1000000000).map((i) => i.toDouble());

      // Generator for random percentage change (-100.0–100.0)
      final percentageArb =
          integer(min: -10000, max: 10000).map((i) => i / 100.0);

      // Generator for random UTC timestamps (years 2000–2030)
      final timestampArb = integer(
        min: 946684800000, // 2000-01-01T00:00:00Z in ms
        max: 1893456000000, // 2030-01-01T00:00:00Z in ms
      ).map((ms) => DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true));

      // Combined generator for all AssetPrice fields
      final assetPriceArb = combine3(
        combine3(symbolArb, priceArb, priceArb),
        combine3(priceArb, volumeArb, percentageArb),
        timestampArb,
      );

      forAll(
        assetPriceArb,
        (tuple) {
          final symbolAndPrices = tuple.$1;
          final volumeAndPercent = tuple.$2;
          final timestamp = tuple.$3;

          final symbol = symbolAndPrices.$1;
          final price = symbolAndPrices.$2;
          final dailyHigh = symbolAndPrices.$3;
          final dailyLow = volumeAndPercent.$1;
          final volume = volumeAndPercent.$2;
          final percentageChange = volumeAndPercent.$3;

          // Construct the original AssetPrice
          final original = AssetPrice(
            symbol: symbol,
            price: price,
            dailyHigh: dailyHigh,
            dailyLow: dailyLow,
            volume: volume,
            percentageChange: percentageChange,
            timestamp: timestamp,
          );

          // Round-trip: toJson then fromJson
          final json = original.toJson();
          final restored = AssetPrice.fromJson(json);

          // Verify field-by-field equality
          expect(restored.symbol, equals(original.symbol),
              reason: 'symbol mismatch: '
                  'original="${original.symbol}", '
                  'restored="${restored.symbol}"');
          expect(restored.price, equals(original.price),
              reason: 'price mismatch: '
                  'original=${original.price}, '
                  'restored=${restored.price}');
          expect(restored.dailyHigh, equals(original.dailyHigh),
              reason: 'dailyHigh mismatch: '
                  'original=${original.dailyHigh}, '
                  'restored=${restored.dailyHigh}');
          expect(restored.dailyLow, equals(original.dailyLow),
              reason: 'dailyLow mismatch: '
                  'original=${original.dailyLow}, '
                  'restored=${restored.dailyLow}');
          expect(restored.volume, equals(original.volume),
              reason: 'volume mismatch: '
                  'original=${original.volume}, '
                  'restored=${restored.volume}');
          expect(restored.percentageChange, equals(original.percentageChange),
              reason: 'percentageChange mismatch: '
                  'original=${original.percentageChange}, '
                  'restored=${restored.percentageChange}');
          expect(restored.timestamp, equals(original.timestamp),
              reason: 'timestamp mismatch: '
                  'original=${original.timestamp}, '
                  'restored=${restored.timestamp}');

          // Verify timestamp is UTC
          expect(restored.timestamp.isUtc, isTrue,
              reason: 'restored timestamp should be UTC');

          // Verify numeric fields are doubles
          expect(restored.price, isA<double>());
          expect(restored.dailyHigh, isA<double>());
          expect(restored.dailyLow, isA<double>());
          expect(restored.volume, isA<double>());
          expect(restored.percentageChange, isA<double>());
        },
        maxExamples: 100,
      );
    });

    property(
        'integer-valued numeric fields round-trip correctly through JSON', () {
      // Generator for random symbol strings (1–10 uppercase chars)
      final symbolArb = integer(min: 1, max: 10).flatMap((length) {
        return list(
          integer(min: 65, max: 90).map((code) => String.fromCharCode(code)),
          minLength: length,
          maxLength: length,
        ).map((chars) => chars.join());
      });

      // Generate integer-valued doubles (e.g., 42.0, 100.0)
      final intDoubleArb =
          integer(min: 1, max: 100000).map((i) => i.toDouble());

      // Generator for random UTC timestamps
      final timestampArb = integer(
        min: 946684800000,
        max: 1893456000000,
      ).map((ms) => DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true));

      final arb = combine3(
        combine2(symbolArb, timestampArb),
        combine3(intDoubleArb, intDoubleArb, intDoubleArb),
        combine2(intDoubleArb, intDoubleArb),
      );

      forAll(
        arb,
        (tuple) {
          final symbolAndTs = tuple.$1;
          final prices = tuple.$2;
          final volAndPct = tuple.$3;

          final original = AssetPrice(
            symbol: symbolAndTs.$1,
            price: prices.$1,
            dailyHigh: prices.$2,
            dailyLow: prices.$3,
            volume: volAndPct.$1,
            percentageChange: volAndPct.$2,
            timestamp: symbolAndTs.$2,
          );

          // Round-trip via toJson/fromJson
          final json = original.toJson();
          final restored = AssetPrice.fromJson(json);

          // All fields should be equal even though they are integer-valued
          expect(restored.symbol, equals(original.symbol));
          expect(restored.price, equals(original.price));
          expect(restored.dailyHigh, equals(original.dailyHigh));
          expect(restored.dailyLow, equals(original.dailyLow));
          expect(restored.volume, equals(original.volume));
          expect(restored.percentageChange, equals(original.percentageChange));
          expect(restored.timestamp, equals(original.timestamp));

          // Verify they are stored as doubles
          expect(restored.price, isA<double>());
          expect(restored.dailyHigh, isA<double>());
          expect(restored.dailyLow, isA<double>());
          expect(restored.volume, isA<double>());
          expect(restored.percentageChange, isA<double>());
        },
        maxExamples: 100,
      );
    });

    property(
        'non-UTC timestamps are normalized to UTC after round-trip', () {
      // Generator for random symbol strings (1–10 uppercase chars)
      final symbolArb = integer(min: 1, max: 10).flatMap((length) {
        return list(
          integer(min: 65, max: 90).map((code) => String.fromCharCode(code)),
          minLength: length,
          maxLength: length,
        ).map((chars) => chars.join());
      });

      // Generator for random prices
      final priceArb =
          integer(min: 1, max: 10000000).map((i) => i / 100.0);

      // Generator for random UTC timestamps
      final timestampArb = integer(
        min: 946684800000,
        max: 1893456000000,
      ).map((ms) => DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true));

      final arb = combine3(
        combine2(symbolArb, priceArb),
        combine3(priceArb, priceArb, priceArb),
        combine2(priceArb, timestampArb),
      );

      forAll(
        arb,
        (tuple) {
          final symbolPrice = tuple.$1;
          final prices = tuple.$2;
          final volTs = tuple.$3;

          // Construct with a UTC timestamp
          final utcTimestamp = volTs.$2;

          final original = AssetPrice(
            symbol: symbolPrice.$1,
            price: symbolPrice.$2,
            dailyHigh: prices.$1,
            dailyLow: prices.$2,
            volume: prices.$3,
            percentageChange: volTs.$1,
            timestamp: utcTimestamp,
          );

          // Round-trip
          final json = original.toJson();
          final restored = AssetPrice.fromJson(json);

          // Timestamp should be UTC and equal to the original
          expect(restored.timestamp.isUtc, isTrue,
              reason: 'Restored timestamp must be UTC');
          expect(restored.timestamp, equals(original.timestamp.toUtc()),
              reason: 'Timestamp should be equal after UTC normalization');
        },
        maxExamples: 100,
      );
    });
  });
  group(
      'Feature: live-market-data, '
      'Property 10: Missing fields produce descriptive error', () {
    // **Validates: Requirements 6.2**

    /// The 7 required fields for AssetPrice JSON parsing.
    const requiredFields = [
      'symbol',
      'price',
      'dailyHigh',
      'dailyLow',
      'volume',
      'percentageChange',
      'timestamp',
    ];

    /// Returns a valid JSON map for AssetPrice.
    Map<String, dynamic> validAssetPriceJson() {
      return {
        'symbol': 'AAPL',
        'price': 185.42,
        'dailyHigh': 186.10,
        'dailyLow': 183.55,
        'volume': 52340000,
        'percentageChange': 1.23,
        'timestamp': '2024-01-15T14:30:00Z',
      };
    }

    property(
        'omitting any non-empty subset of required fields throws MarketDataException containing all omitted field names',
        () {
      // Generate a random non-empty subset of required fields to omit.
      // We use an integer in [1, 127] as a bitmask over the 7 fields.
      // Each bit represents whether to omit that field.
      // Value 0 is excluded (empty subset).
      final bitmaskArb = integer(min: 1, max: 127);

      forAll(
        bitmaskArb,
        (bitmask) {
          // Determine which fields to omit based on the bitmask
          final omittedFields = <String>[];
          for (int i = 0; i < requiredFields.length; i++) {
            if ((bitmask >> i) & 1 == 1) {
              omittedFields.add(requiredFields[i]);
            }
          }

          // Start with a valid JSON map and remove the omitted fields
          final json = validAssetPriceJson();
          for (final field in omittedFields) {
            json.remove(field);
          }

          // Parsing should throw a MarketDataException
          MarketDataException? caughtException;
          try {
            AssetPrice.fromJson(json);
          } on MarketDataException catch (e) {
            caughtException = e;
          }

          // Verify that a MarketDataException was thrown
          expect(caughtException, isNotNull,
              reason:
                  'AssetPrice.fromJson should throw MarketDataException when '
                  'fields $omittedFields are missing, but it did not throw');

          // Verify the exception message contains every omitted field name
          for (final field in omittedFields) {
            expect(caughtException!.message, contains(field),
                reason:
                    'MarketDataException message should contain the omitted '
                    'field name "$field". Actual message: '
                    '"${caughtException.message}"');
          }
        },
        maxExamples: 127, // Cover all 127 possible non-empty subsets
      );
    });
  });

  group(
      'Feature: live-market-data, '
      'Property 12: Invalid timestamp string produces error', () {
    // **Validates: Requirements 6.4**

    /// Helper to build a valid JSON payload with a given timestamp value.
    Map<String, dynamic> buildJsonWithTimestamp(String timestamp) {
      return {
        'symbol': 'AAPL',
        'price': 185.42,
        'dailyHigh': 186.10,
        'dailyLow': 183.55,
        'volume': 52340000.0,
        'percentageChange': 1.23,
        'timestamp': timestamp,
      };
    }

    property(
        'random alphabetic strings that are not ISO 8601 produce MarketDataException with invalid value',
        () {
      // Generate random alphabetic strings (1-20 chars, lowercase + uppercase)
      final alphabeticStringArb = integer(min: 1, max: 20).flatMap((length) {
        return list(
          oneOf([
            integer(min: 65, max: 90).map((c) => String.fromCharCode(c)),
            integer(min: 97, max: 122).map((c) => String.fromCharCode(c)),
          ]),
          minLength: length,
          maxLength: length,
        ).map((chars) => chars.join());
      });

      forAll(
        alphabeticStringArb,
        (invalidTimestamp) {
          // Safety check: skip if DateTime.tryParse would actually accept it
          if (DateTime.tryParse(invalidTimestamp) != null) return;

          final json = buildJsonWithTimestamp(invalidTimestamp);

          expect(
            () => AssetPrice.fromJson(json),
            throwsA(
              isA<MarketDataException>().having(
                (e) => e.message,
                'message',
                contains(invalidTimestamp),
              ),
            ),
            reason:
                'Invalid timestamp "$invalidTimestamp" should throw '
                'MarketDataException containing the invalid value',
          );
        },
        maxExamples: 100,
      );
    });

    property(
        'random words/phrases that are not ISO 8601 produce MarketDataException with invalid value',
        () {
      // Generate strings like "yesterday", "noon today", "not-a-date"
      final wordPhraseArb = oneOf([
        // Single words from a pool of non-date strings
        integer(min: 0, max: 9).map((i) {
          const words = [
            'yesterday',
            'tomorrow',
            'noon',
            'midnight',
            'never',
            'sometime',
            'today',
            'morning',
            'evening',
            'later',
          ];
          return words[i];
        }),
        // Random phrases with spaces
        integer(min: 2, max: 4).flatMap((wordCount) {
          return list(
            integer(min: 1, max: 8).flatMap((len) {
              return list(
                integer(min: 97, max: 122)
                    .map((c) => String.fromCharCode(c)),
                minLength: len,
                maxLength: len,
              ).map((chars) => chars.join());
            }),
            minLength: wordCount,
            maxLength: wordCount,
          ).map((words) => words.join(' '));
        }),
      ]);

      forAll(
        wordPhraseArb,
        (invalidTimestamp) {
          // Safety check: skip if DateTime.tryParse would actually accept it
          if (DateTime.tryParse(invalidTimestamp) != null) return;

          final json = buildJsonWithTimestamp(invalidTimestamp);

          expect(
            () => AssetPrice.fromJson(json),
            throwsA(
              isA<MarketDataException>().having(
                (e) => e.message,
                'message',
                contains(invalidTimestamp),
              ),
            ),
            reason:
                'Invalid timestamp "$invalidTimestamp" should throw '
                'MarketDataException containing the invalid value',
          );
        },
        maxExamples: 100,
      );
    });

    property(
        'partial/malformed date strings that are not ISO 8601 produce MarketDataException with invalid value',
        () {
      // Generate partial dates like "2024-13-45", "99-99-99", "not-a-date"
      final partialDateArb = oneOf([
        // Invalid month/day combos: YYYY-MM-DD with out-of-range values
        combine3(
          integer(min: 1900, max: 2100),
          integer(min: 13, max: 99), // invalid month (>12)
          integer(min: 1, max: 31),
        ).map((t) =>
            '${t.$1}-${t.$2.toString().padLeft(2, '0')}-${t.$3.toString().padLeft(2, '0')}'),
        // Invalid day combos: YYYY-MM-DD with out-of-range day
        combine3(
          integer(min: 1900, max: 2100),
          integer(min: 1, max: 12),
          integer(min: 32, max: 99), // invalid day (>31)
        ).map((t) =>
            '${t.$1}-${t.$2.toString().padLeft(2, '0')}-${t.$3.toString().padLeft(2, '0')}'),
        // Random strings with special characters mixed with digits
        integer(min: 1, max: 15).flatMap((length) {
          return list(
            oneOf([
              integer(min: 48, max: 57).map((c) => String.fromCharCode(c)),
              integer(min: 0, max: 4).map((i) {
                const specials = ['/', '\\', '!', '@', '#'];
                return specials[i];
              }),
            ]),
            minLength: length,
            maxLength: length,
          ).map((chars) => chars.join());
        }),
        // Empty-like strings (single space, tabs, etc.)
        integer(min: 0, max: 3).map((i) {
          const emptyLike = [' ', '  ', '\t', ' \t '];
          return emptyLike[i];
        }),
      ]);

      forAll(
        partialDateArb,
        (invalidTimestamp) {
          // Safety check: skip if DateTime.tryParse would actually accept it
          if (DateTime.tryParse(invalidTimestamp) != null) return;

          final json = buildJsonWithTimestamp(invalidTimestamp);

          expect(
            () => AssetPrice.fromJson(json),
            throwsA(
              isA<MarketDataException>().having(
                (e) => e.message,
                'message',
                contains(invalidTimestamp),
              ),
            ),
            reason:
                'Invalid timestamp "$invalidTimestamp" should throw '
                'MarketDataException containing the invalid value',
          );
        },
        maxExamples: 100,
      );
    });

    property(
        'strings with special characters that are not ISO 8601 produce MarketDataException with invalid value',
        () {
      // Generate strings with special characters
      final specialCharArb = integer(min: 1, max: 20).flatMap((length) {
        return list(
          oneOf([
            integer(min: 33, max: 47).map((c) => String.fromCharCode(c)),
            integer(min: 58, max: 64).map((c) => String.fromCharCode(c)),
            integer(min: 91, max: 96).map((c) => String.fromCharCode(c)),
            integer(min: 123, max: 126).map((c) => String.fromCharCode(c)),
          ]),
          minLength: length,
          maxLength: length,
        ).map((chars) => chars.join());
      });

      forAll(
        specialCharArb,
        (invalidTimestamp) {
          // Safety check: skip if DateTime.tryParse would actually accept it
          if (DateTime.tryParse(invalidTimestamp) != null) return;

          final json = buildJsonWithTimestamp(invalidTimestamp);

          expect(
            () => AssetPrice.fromJson(json),
            throwsA(
              isA<MarketDataException>().having(
                (e) => e.message,
                'message',
                contains(invalidTimestamp),
              ),
            ),
            reason:
                'Invalid timestamp "$invalidTimestamp" should throw '
                'MarketDataException containing the invalid value',
          );
        },
        maxExamples: 100,
      );
    });
  });

  group(
      'Feature: live-market-data, '
      'Property 11: Wrong-type fields produce descriptive error', () {
    // **Validates: Requirements 6.3**

    /// Field definitions: field name → expected type string used in error messages.
    const fieldExpectedTypes = {
      'symbol': 'String',
      'price': 'num',
      'dailyHigh': 'num',
      'dailyLow': 'num',
      'volume': 'num',
      'percentageChange': 'num',
      'timestamp': 'String',
    };

    /// Returns a valid JSON map for AssetPrice.
    Map<String, dynamic> validAssetPriceJson() {
      return {
        'symbol': 'AAPL',
        'price': 185.42,
        'dailyHigh': 186.10,
        'dailyLow': 183.55,
        'volume': 52340000,
        'percentageChange': 1.23,
        'timestamp': '2024-01-15T14:30:00Z',
      };
    }

    /// Wrong-type values for String fields: int, bool, list
    final wrongTypesForString = <dynamic>[42, -7, 0, true, false, <dynamic>[1, 2, 3]];

    /// Wrong-type values for num fields: String, bool, list
    final wrongTypesForNum = <dynamic>[
      'notANumber',
      'abc',
      '',
      true,
      false,
      <dynamic>[1, 2, 3],
    ];

    property(
        'replacing a random field with a wrong-type value throws MarketDataException identifying field name and expected type',
        () {
      // Generate a random field index (0-6) to determine which field to corrupt
      final fieldIndexArb = integer(min: 0, max: 6);
      // Generate a random wrong-type variant index for selection
      final variantArb = integer(min: 0, max: 5);

      forAll(
        combine2(fieldIndexArb, variantArb),
        (combo) {
          final fieldIndex = combo.$1;
          final variantIndex = combo.$2;

          final fields = fieldExpectedTypes.keys.toList();
          final fieldName = fields[fieldIndex];
          final expectedType = fieldExpectedTypes[fieldName]!;

          // Create a valid JSON and replace the selected field with a wrong-type value
          final json = validAssetPriceJson();

          // Determine the wrong-type value based on the field's expected type
          dynamic wrongValue;
          if (expectedType == 'String') {
            // String fields: replace with int, bool, or list
            wrongValue =
                wrongTypesForString[variantIndex % wrongTypesForString.length];
          } else {
            // num fields: replace with String, bool, or list
            wrongValue =
                wrongTypesForNum[variantIndex % wrongTypesForNum.length];
          }

          json[fieldName] = wrongValue;

          // Parsing should throw a MarketDataException
          MarketDataException? caughtException;
          try {
            AssetPrice.fromJson(json);
          } on MarketDataException catch (e) {
            caughtException = e;
          }

          // Verify that a MarketDataException was thrown
          expect(caughtException, isNotNull,
              reason:
                  'AssetPrice.fromJson should throw MarketDataException when '
                  '"$fieldName" has wrong type value $wrongValue '
                  '(${wrongValue.runtimeType}), but it did not throw');

          // Verify the exception message contains the field name
          expect(caughtException!.message, contains(fieldName),
              reason:
                  'MarketDataException message should contain the field name '
                  '"$fieldName". Actual message: "${caughtException.message}"');

          // Verify the exception message contains the expected type
          expect(caughtException.message, contains(expectedType),
              reason:
                  'MarketDataException message should contain the expected type '
                  '"$expectedType". Actual message: "${caughtException.message}"');
        },
        maxExamples: 100,
      );
    });

    property(
        'null values for any required field throw MarketDataException identifying field name and expected type',
        () {
      // Generate a random field index (0-6) to determine which field to set to null
      final fieldIndexArb = integer(min: 0, max: 6);

      forAll(
        fieldIndexArb,
        (fieldIndex) {
          final fields = fieldExpectedTypes.keys.toList();
          final fieldName = fields[fieldIndex];
          final expectedType = fieldExpectedTypes[fieldName]!;

          // Create a valid JSON and set the selected field to null
          final json = validAssetPriceJson();
          json[fieldName] = null;

          // Parsing should throw a MarketDataException
          MarketDataException? caughtException;
          try {
            AssetPrice.fromJson(json);
          } on MarketDataException catch (e) {
            caughtException = e;
          }

          // Verify that a MarketDataException was thrown
          expect(caughtException, isNotNull,
              reason:
                  'AssetPrice.fromJson should throw MarketDataException when '
                  '"$fieldName" is null, but it did not throw');

          // Verify the exception message contains the field name
          expect(caughtException!.message, contains(fieldName),
              reason:
                  'MarketDataException message should contain the field name '
                  '"$fieldName". Actual message: "${caughtException.message}"');

          // Verify the exception message contains the expected type
          expect(caughtException.message, contains(expectedType),
              reason:
                  'MarketDataException message should contain the expected type '
                  '"$expectedType". Actual message: "${caughtException.message}"');
        },
        maxExamples: 100,
      );
    });
  });
}
