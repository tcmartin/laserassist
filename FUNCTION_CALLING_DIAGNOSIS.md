# Function Calling Diagnosis and Fix

## Problem Summary

The MCP function calling system is experiencing issues where:

1. **JSON Parsing Errors**: The LLM generates malformed JSON when attempting function calls
   - Error: `Unexpected token '}', ..."shness": }" is not valid JSON`
   - This happens specifically with the `freshness` parameter in brave search functions

2. **LLM Not Calling Functions**: Even with explicit instructions, the LLM responds with JSON in markdown code blocks instead of actually invoking functions
   - LLM outputs: `{"query": "test"}` in code blocks
   - But doesn't actually call the function

## Root Cause Analysis

### 1. MCP Functions Work Correctly
- ✅ MCP connections are established successfully
- ✅ Function schemas are properly formatted
- ✅ Manual function calls work perfectly
- ✅ Function handlers execute correctly and return proper results

### 2. Function Schema Issues
The `freshness` parameter has a complex schema with `anyOf`:
```json
"freshness": {
  "anyOf": [
    {
      "type": "string",
      "enum": ["pd", "pw", "pm", "py"]
    },
    {
      "type": "string", 
      "pattern": "^\\d{4}-\\d{2}-\\d{2}to\\d{4}-\\d{2}-\\d{2}$"
    }
  ]
}
```

This complex schema confuses the LLM, causing it to generate incomplete JSON like:
```json
{"query": "search term", "freshness": }
```

### 3. LLM Model Configuration Issue
The primary issue appears to be that the LLM model (gemma-3-4b-it-Q4_0.gguf) is not properly configured for function calling or doesn't understand the function calling protocol used by `node-llama-cpp`.

## Attempted Fixes

### 1. ✅ Improved Error Handling
- Added detailed JSON syntax error detection
- Provided specific guidance for common JSON errors
- Made error messages more insistent to encourage retry

### 2. ✅ Enhanced Logging
- Added comprehensive function call tracking
- Improved error analysis and reporting
- Added performance metrics

### 3. ❌ Direct Function Call Instructions
- Tried explicit JSON examples
- Used simple parameter sets
- Still resulted in LLM describing rather than calling functions

## Required Fix

The issue is likely one of the following:

### Option 1: Model Compatibility Issue
The current model `gemma-3-4b-it-Q4_0.gguf` may not support function calling properly. Consider:
- Using a different model that's specifically trained for function calling
- Checking if the model needs specific prompting for function calls
- Verifying `node-llama-cpp` compatibility with this model

### Option 2: Function Definition Format Issue
The function definitions may need to be in a different format:
- Check `node-llama-cpp` documentation for proper function schema format
- Verify if the `params` vs `parameters` naming is correct
- Ensure the function handler signature matches expectations

### Option 3: Session Configuration Issue
The LlamaChatSession may need specific configuration:
- Check if function calling needs to be explicitly enabled
- Verify session options are correctly passed
- Ensure the context size is sufficient for function definitions

## Recommended Next Steps

1. **Test with a known function-calling model** (e.g., a model specifically trained for tool use)
2. **Verify node-llama-cpp function calling examples** work with our setup
3. **Simplify function schemas** by removing complex `anyOf` patterns
4. **Check model documentation** for function calling requirements
5. **Consider alternative approaches** like structured output parsing if function calling isn't supported

## Test Results

- ✅ MCP connections: Working
- ✅ Function schemas: Valid
- ✅ Manual function calls: Working  
- ❌ LLM function calling: Not working
- ✅ Error handling: Improved
- ✅ Logging: Comprehensive

The system is ready for function calling - we just need to resolve the LLM model compatibility issue.