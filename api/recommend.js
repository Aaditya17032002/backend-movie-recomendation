const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');

// Helper function to build Gemini prompt
function buildGeminiPrompt(likedMovies, preferences) {
    const page = preferences.page || 1;
    const offset = (page - 1) * 5;
    return `You are a movie recommendation expert. Based on the following information, recommend 5 movies that would match the user's taste. Return ONLY a valid JSON object with no additional text or formatting.

Input:
Liked Movies: ${likedMovies.join(', ')}
Preferences:
- Genres: ${preferences.genres.join(', ')}
- Language: ${preferences.language}
- Mood: ${preferences.mood}
- Page: ${page}

Important: For each page, recommend DIFFERENT movies that haven't been recommended before. If this is page ${page}, recommend movies ${offset + 1} to ${offset + 5} in your list of recommendations.

Return a JSON object in this exact format:
{
    "recommendations": [
        {
            "title": "Movie Title",
            "reasoning": "Why this movie matches the user's taste",
            "genres": ["genre1", "genre2"],
            "mood": "mood of the movie"
        }
    ]
}

Important: Return ONLY the JSON object, no additional text, no markdown formatting, no backticks.`;
}

// Helper function to fetch TMDB data
async function fetchTMDBData(movieTitle) {
    try {
        const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
        const searchResponse = await axios.get(`${TMDB_BASE_URL}/search/movie`, {
            params: {
                api_key: process.env.TMDB_API_KEY,
                query: movieTitle
            }
        });
        if (!searchResponse.data.results.length) {
            return null;
        }
        const movieId = searchResponse.data.results[0].id;
        const detailsResponse = await axios.get(`${TMDB_BASE_URL}/movie/${movieId}`, {
            params: {
                api_key: process.env.TMDB_API_KEY,
                append_to_response: 'credits'
            }
        });
        return {
            tmdb_id: movieId,
            poster_path: detailsResponse.data.poster_path,
            backdrop_path: detailsResponse.data.backdrop_path,
            release_date: detailsResponse.data.release_date,
            runtime: detailsResponse.data.runtime,
            genres: detailsResponse.data.genres.map(g => g.name),
            cast: detailsResponse.data.credits.cast.slice(0, 5).map(actor => ({
                name: actor.name,
                character: actor.character
            })),
            crew: detailsResponse.data.credits.crew.slice(0, 5).map(member => ({
                name: member.name,
                job: member.job
            }))
        };
    } catch (error) {
        console.error('TMDB API Error:', error);
        return null;
    }
}

// Helper function to fetch OMDb data
async function fetchOMDBData(movieTitle) {
    try {
        const OMDB_BASE_URL = 'http://www.omdbapi.com/';
        const response = await axios.get(OMDB_BASE_URL, {
            params: {
                apikey: process.env.OMDB_API_KEY,
                t: movieTitle
            }
        });
        if (response.data.Response === 'False') {
            return null;
        }
        return {
            imdb_rating: response.data.imdbRating,
            plot: response.data.Plot,
            awards: response.data.Awards,
            box_office: response.data.BoxOffice
        };
    } catch (error) {
        console.error('OMDb API Error:', error);
        return null;
    }
}

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    try {
        const { likedMovies, preferences } = req.body || (typeof req.body === 'string' ? JSON.parse(req.body) : {});
        if (!likedMovies || !preferences) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const prompt = buildGeminiPrompt(likedMovies, preferences);
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const responseText = response.text().trim();
        const cleanResponse = responseText.replace(/```json\n?|\n?```/g, '').trim();
        let recommendations;
        try {
            recommendations = JSON.parse(cleanResponse).recommendations;
        } catch (parseError) {
            console.error('Failed to parse Gemini response:', cleanResponse);
            throw new Error('Failed to parse AI response');
        }
        const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500';
        const enrichedRecommendations = await Promise.all(
            recommendations.map(async (rec) => {
                const tmdbData = await fetchTMDBData(rec.title);
                const omdbData = await fetchOMDBData(rec.title);
                return {
                    ...rec,
                    tmdb_data: tmdbData,
                    omdb_data: omdbData,
                    poster_url: tmdbData ? `${TMDB_IMAGE_BASE_URL}${tmdbData.poster_path}` : null,
                    backdrop_url: tmdbData ? `${TMDB_IMAGE_BASE_URL}${tmdbData.backdrop_path}` : null
                };
            })
        );
        res.status(200).json({ recommendations: enrichedRecommendations });
    } catch (error) {
        console.error('Recommendation Error:', error);
        res.status(500).json({
            error: 'Failed to generate recommendations',
            details: error.message
        });
    }
}; 