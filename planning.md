
# MicroBitLogManager

1. Operations
   1. Allows connection to a (possibly new) micro:bit. Select merge data or flush old data.
2. Data: 
   1. Collection of micro:bit objects
      1. Operations
         1. Download raw CSV
         2. Download derived CSV
         3. Reconnect (merge or flush)
         4. Disconnect
         5. Erase all
      2. Data 
         1. Advertised Name / ID number and "Preferred name". 
         2. Data Store
            1. Actual CSV 
            2. Callback
                Called when new data available
            4. Data Series Collection
               1. Heading
               2. Type:  Series or Time Series
               3. Samples Collection
                  1. Timestamp and wall-clock time (if known) or index 
                  2. Value
