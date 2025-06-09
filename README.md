# AI Movie Recommendation System

An intelligent movie recommendation system that uses Gemini AI, TMDB, and OMDb APIs to provide personalized movie suggestions based on user preferences.

## Features

- AI-powered movie recommendations using Google's Gemini AI
- Rich movie metadata from TMDB (posters, cast, crew, etc.)
- Additional movie information from OMDb (ratings, plot, awards)
- Rate limiting to prevent API abuse
- Error handling and fallback mechanisms

## Prerequisites

- Node.js (v14 or higher)
- API keys for:
  - Google Gemini AI
  - TMDB (The Movie Database)
  - OMDb (Open Movie Database)

## Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd movie-recommendation
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory with your API keys:
```
GEMINI_API_KEY=your_gemini_api_key
TMDB_API_KEY=your_tmdb_api_key
OMDB_API_KEY=your_omdb_api_key
PORT=3000
NODE_ENV=development
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

4. Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

## API Usage

### Get Movie Recommendations

**Endpoint:** `POST /api/recommend`

**Request Body:**
```json
{
    "likedMovies": ["The Shawshank Redemption", "Inception", "The Dark Knight"],
    "preferences": {
        "genres": ["Drama", "Thriller"],
        "language": "English",
        "mood": "Thought-provoking"
    }
}
```

**Response:**
```json
{
    "recommendations": [
        {
            "title": "Movie Title",
            "reasoning": "Why this movie matches the user's taste",
            "genres": ["genre1", "genre2"],
            "mood": "mood of the movie",
            "tmdb_data": {
                "poster_path": "/path/to/poster.jpg",
                "backdrop_path": "/path/to/backdrop.jpg",
                "release_date": "2023-01-01",
                "runtime": 120,
                "genres": ["Drama", "Thriller"],
                "cast": [...],
                "crew": [...]
            },
            "omdb_data": {
                "imdb_rating": "8.5",
                "plot": "Movie plot...",
                "awards": "Oscar winner...",
                "box_office": "$100M"
            },
            "poster_url": "https://image.tmdb.org/t/p/w500/path/to/poster.jpg",
            "backdrop_url": "https://image.tmdb.org/t/p/w500/path/to/backdrop.jpg"
        }
    ]
}
```

## Error Handling

The API includes comprehensive error handling for:
- Missing required parameters
- API rate limits
- Movie not found
- Gemini API errors
- TMDB/OMDb API errors

## Rate Limiting

The API implements rate limiting to prevent abuse:
- 100 requests per 15 minutes by default
- Configurable through environment variables

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request

## License

MIT 