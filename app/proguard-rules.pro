# Keep line numbers for readable stack traces.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ZXing looks readers up by enum, nothing reflective, but keep the result types stable.
-dontwarn com.google.zxing.**
